import { TeacherAccessAraIdChallengeStore } from './teacher-access-araid-challenge.store';

describe('TeacherAccessAraIdChallengeStore', () => {
  it('claims, resumes, approves, and consumes an in-memory challenge once', async () => {
    const store = new TeacherAccessAraIdChallengeStore({ getClient: () => undefined } as never);
    const challenge = await store.create('grant-1');

    await expect(store.read(challenge.token)).resolves.toMatchObject({
      grantId: 'grant-1',
      status: 'PENDING',
    });
    const authorization = await store.claim(challenge.token);
    expect(authorization).not.toBeNull();
    await expect(
      store.resume(challenge.token, authorization!.authorizationToken),
    ).resolves.toMatchObject({ authorizationToken: authorization!.authorizationToken });
    await expect(store.approveAuthorization(authorization!.authorizationToken)).resolves.toBe(true);
    await expect(store.consumeApproved(challenge.token)).resolves.toMatchObject({
      grantId: 'grant-1',
      status: 'APPROVED',
    });
    await expect(store.consumeApproved(challenge.token)).resolves.toBeNull();
  });

  it('does not consume a challenge before mobile approval', async () => {
    const store = new TeacherAccessAraIdChallengeStore({ getClient: () => undefined } as never);
    const challenge = await store.create('grant-1');

    await expect(store.consumeApproved(challenge.token)).resolves.toBeNull();
    await expect(store.read(challenge.token)).resolves.toMatchObject({ status: 'PENDING' });
  });

  it('does not resume an authorization for a different challenge', async () => {
    const store = new TeacherAccessAraIdChallengeStore({ getClient: () => undefined } as never);
    const first = await store.create('grant-1');
    const second = await store.create('grant-2');
    const authorization = await store.claim(first.token);

    await expect(store.resume(second.token, authorization!.authorizationToken)).resolves.toBeNull();
  });
});
