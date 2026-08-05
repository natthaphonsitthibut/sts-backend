import { TeacherLineSessionStore } from './teacher-line-session.store';

describe('TeacherLineSessionStore', () => {
  it('consumes an in-memory OAuth state exactly once under concurrency', async () => {
    const store = new TeacherLineSessionStore({ getClient: () => undefined } as never);
    const state = await store.createOAuthState({
      bindingToken: 'binding-token',
      teacherId: '7',
      nonce: 'nonce-value',
    });

    const results = await Promise.all([
      store.consumeOAuthState(state),
      store.consumeOAuthState(state),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.filter((value) => value === null)).toHaveLength(1);
  });

  it('uses one Redis script to read and delete a state', async () => {
    const payload = JSON.stringify({
      bindingToken: 'binding-token',
      teacherId: '7',
      nonce: 'nonce-value',
    });
    const client = { eval: jest.fn().mockResolvedValue(payload) };
    const store = new TeacherLineSessionStore({ getClient: () => client } as never);

    await expect(store.consumeOAuthState('state-value')).resolves.toEqual(JSON.parse(payload));
    expect(client.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('DEL', KEYS[1])"),
      1,
      'sts:line-link:state:state-value',
    );
  });
});
