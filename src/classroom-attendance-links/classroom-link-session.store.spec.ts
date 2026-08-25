import { ClassroomLinkSessionStore } from './classroom-link-session.store';

describe('ClassroomLinkSessionStore', () => {
  const payload = {
    linkId: '11111111-1111-4111-8111-111111111111',
    tokenHash: 'a'.repeat(64),
    teacherId: '7',
    teacherMembershipId: '12',
    schoolId: 10,
    provider: 'GOOGLE' as const,
  };

  it('signs a link-bound fallback session and rejects tampering', async () => {
    const store = new ClassroomLinkSessionStore(
      { getClient: () => null } as never,
      { sessionSecret: 'a-secure-session-secret', magicSessionTtlSeconds: 60 } as never,
    );
    const token = await store.issue(payload);

    await expect(store.read(token)).resolves.toMatchObject(payload);
    await expect(store.read(`${token}x`)).resolves.toBeNull();
  });
});
