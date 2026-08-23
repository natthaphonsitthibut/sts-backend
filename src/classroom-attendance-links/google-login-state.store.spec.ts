import { GoogleLoginStateStore } from './google-login-state.store';

describe('GoogleLoginStateStore', () => {
  it('consumes a state exactly once and keeps link id plus token version server-side', async () => {
    const store = new GoogleLoginStateStore(
      { getClient: () => null } as never,
      { magicSessionTtlSeconds: 600 } as never,
    );
    const created = await store.create('link-id', 'token-hash');

    await expect(store.consume(created.state)).resolves.toMatchObject({
      linkId: 'link-id',
      tokenHash: 'token-hash',
      nonce: created.nonce,
    });
    await expect(store.consume(created.state)).resolves.toBeNull();
  });

  it('uses one atomic Redis operation when consuming a state', async () => {
    const payload = JSON.stringify({
      linkId: 'link-id',
      tokenHash: 'token-hash',
      nonce: 'nonce',
      expiresAt: Date.now() + 60_000,
    });
    const client = {
      eval: jest.fn().mockResolvedValue(payload),
    };
    const store = new GoogleLoginStateStore(
      { getClient: () => client } as never,
      { magicSessionTtlSeconds: 600 } as never,
    );

    await expect(store.consume('state')).resolves.toMatchObject({ linkId: 'link-id' });
    expect(client.eval).toHaveBeenCalledTimes(1);
    const calls = client.eval.mock.calls as unknown as Array<[string, number, string]>;
    expect(calls[0][0]).toContain("redis.call('GET', KEYS[1])");
    expect(calls[0][0]).toContain("redis.call('DEL', KEYS[1])");
  });
});
