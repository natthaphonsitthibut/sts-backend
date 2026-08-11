import { TeacherLineSessionStore } from './teacher-line-session.store';

describe('TeacherLineSessionStore', () => {
  const encryption = {
    encrypt: (value: string) => `encrypted:${value}`,
    decrypt: (value: string) => value.replace(/^encrypted:/, ''),
  };

  it('keeps one active group invitation and revokes it by id', async () => {
    const store = new TeacherLineSessionStore(
      { getClient: () => undefined } as never,
      encryption as never,
    );
    const created = await store.createGroupInvitation({
      schoolId: 10,
      schoolName: 'โรงเรียน A',
      startsAt: Date.now() - 1_000,
      expiresAt: Date.now() + 60_000,
    });
    expect(created).not.toBeNull();
    if (!created) throw new Error('Expected an invitation');

    await expect(store.readGroupInvitation(created.token)).resolves.toMatchObject({
      id: created.id,
    });
    await expect(store.readActiveGroupInvitation(10)).resolves.toMatchObject({
      id: created.id,
      schoolId: 10,
      schoolName: 'โรงเรียน A',
      shareToken: created.token,
    });
    await expect(
      store.createGroupInvitation({
        schoolId: 10,
        schoolName: 'โรงเรียน A',
        startsAt: Date.now(),
        expiresAt: Date.now() + 120_000,
      }),
    ).resolves.toBeNull();
    await expect(
      store.createGroupInvitation({
        schoolId: 11,
        schoolName: 'โรงเรียน B',
        startsAt: Date.now(),
        expiresAt: Date.now() + 120_000,
      }),
    ).resolves.not.toBeNull();
    await expect(store.revokeGroupInvitation(created.id, 10)).resolves.toBe(true);
    await expect(store.readGroupInvitation(created.token)).resolves.toBeNull();
  });

  it('consumes an in-memory OAuth state exactly once under concurrency', async () => {
    const store = new TeacherLineSessionStore(
      { getClient: () => undefined } as never,
      encryption as never,
    );
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
    const store = new TeacherLineSessionStore(
      { getClient: () => client } as never,
      encryption as never,
    );

    await expect(store.consumeOAuthState('state-value')).resolves.toEqual(JSON.parse(payload));
    expect(client.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('DEL', KEYS[1])"),
      1,
      'sts:line-link:state:state-value',
    );
  });
});
