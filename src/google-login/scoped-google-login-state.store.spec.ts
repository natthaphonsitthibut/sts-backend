import { ScopedGoogleLoginStateStore } from './scoped-google-login-state.store';

function createStore(client: unknown = null): ScopedGoogleLoginStateStore {
  return new ScopedGoogleLoginStateStore(
    { getClient: () => client } as never,
    {
      magicSessionTtlSeconds: 21_600,
    } as never,
  );
}

describe('ScopedGoogleLoginStateStore', () => {
  it('consumes a state exactly once and keeps the link scope server-side', async () => {
    const store = createStore();
    const created = await store.create('classroom-link', {
      subjectId: 'link-id',
      tokenHash: 'token-hash',
      schoolId: 12,
    });

    await expect(store.consume('classroom-link', created.state)).resolves.toMatchObject({
      flow: 'classroom-link',
      subjectId: 'link-id',
      tokenHash: 'token-hash',
      schoolId: 12,
      nonce: created.nonce,
    });
    await expect(store.consume('classroom-link', created.state)).resolves.toBeNull();
  });

  it('refuses a state issued for another flow', async () => {
    const store = createStore();
    const created = await store.create('task-link', {
      subjectId: 'link-id',
      tokenHash: 'token-hash',
      schoolId: 12,
    });

    await expect(store.consume('classroom-link', created.state)).resolves.toBeNull();
    await expect(store.consume('task-link', created.state)).resolves.toMatchObject({
      subjectId: 'link-id',
    });
  });

  it('caps the redirect window at ten minutes even with a long session TTL', async () => {
    const client = { set: jest.fn().mockResolvedValue('OK') };
    const store = createStore(client);
    await store.create('teacher-line-group', {
      subjectId: 'link-id',
      tokenHash: 'token-hash',
      schoolId: 12,
    });

    const calls = client.set.mock.calls as unknown as Array<[string, string, string, number]>;
    expect(calls[0][2]).toBe('EX');
    expect(calls[0][3]).toBe(600);
  });

  it('uses one atomic Redis operation when consuming a state', async () => {
    const payload = JSON.stringify({
      flow: 'classroom-link',
      subjectId: 'link-id',
      tokenHash: 'token-hash',
      schoolId: 12,
      nonce: 'nonce',
      expiresAt: Date.now() + 60_000,
    });
    const client = { eval: jest.fn().mockResolvedValue(payload) };
    const store = createStore(client);

    await expect(store.consume('classroom-link', 'state')).resolves.toMatchObject({
      subjectId: 'link-id',
    });
    expect(client.eval).toHaveBeenCalledTimes(1);
    const calls = client.eval.mock.calls as unknown as Array<[string, number, string]>;
    expect(calls[0][0]).toContain("redis.call('GET', KEYS[1])");
    expect(calls[0][0]).toContain("redis.call('DEL', KEYS[1])");
  });
});
