import { AraIdChallengeStore } from './araid-challenge.store';

function buildStore(): AraIdChallengeStore {
  return new AraIdChallengeStore({ getClient: () => undefined } as never);
}

describe('AraIdChallengeStore', () => {
  it('claims, resumes, approves, and consumes an in-memory challenge once', async () => {
    const store = buildStore();
    const challenge = await store.create('teacher-access', 'grant-1');

    await expect(store.read('teacher-access', challenge.token)).resolves.toMatchObject({
      subjectId: 'grant-1',
      status: 'PENDING',
    });
    const authorization = await store.claim('teacher-access', challenge.token);
    expect(authorization).not.toBeNull();
    await expect(
      store.resume('teacher-access', challenge.token, authorization!.authorizationToken),
    ).resolves.toMatchObject({ authorizationToken: authorization!.authorizationToken });
    await expect(
      store.approveAuthorization('teacher-access', authorization!.authorizationToken),
    ).resolves.toBe(true);
    await expect(store.consumeApproved('teacher-access', challenge.token)).resolves.toMatchObject({
      subjectId: 'grant-1',
      status: 'APPROVED',
    });
    await expect(store.consumeApproved('teacher-access', challenge.token)).resolves.toBeNull();
  });

  it('does not consume a challenge before mobile approval', async () => {
    const store = buildStore();
    const challenge = await store.create('task-link', 'link-1');

    await expect(store.consumeApproved('task-link', challenge.token)).resolves.toBeNull();
    await expect(store.read('task-link', challenge.token)).resolves.toMatchObject({
      status: 'PENDING',
    });
  });

  it('does not resume an authorization for a different challenge', async () => {
    const store = buildStore();
    const first = await store.create('teacher-access', 'grant-1');
    const second = await store.create('teacher-access', 'grant-2');
    const authorization = await store.claim('teacher-access', first.token);

    await expect(
      store.resume('teacher-access', second.token, authorization!.authorizationToken),
    ).resolves.toBeNull();
  });

  it('keeps flows apart: a challenge cannot be read or redeemed through another scope', async () => {
    const store = buildStore();
    const challenge = await store.create('task-link', 'link-1');

    await expect(store.read('teacher-access', challenge.token)).resolves.toBeNull();
    await expect(store.claim('teacher-access', challenge.token)).resolves.toBeNull();

    const authorization = await store.claim('task-link', challenge.token);
    expect(authorization).not.toBeNull();
    await expect(
      store.readAuthorization('teacher-access', authorization!.authorizationToken),
    ).resolves.toBeNull();
    await expect(
      store.approveAuthorization('teacher-access', authorization!.authorizationToken),
    ).resolves.toBe(false);
  });

  it('keeps an admin login challenge separate from every link flow', async () => {
    const store = buildStore();
    const challenge = await store.create('admin-login', 'admin-login');

    await expect(store.read('teacher-access', challenge.token)).resolves.toBeNull();
    await expect(store.claim('task-link', challenge.token)).resolves.toBeNull();
  });

  it('merges the approval result into the context for the polling side', async () => {
    const store = buildStore();
    const challenge = await store.create('teacher-line', 'invitation-1', { schoolId: 10010002 });
    const authorization = await store.claim('teacher-line', challenge.token);

    await expect(
      store.approveAuthorization('teacher-line', authorization!.authorizationToken, {
        bindingToken: 'binding-1',
        teacherName: 'ครูทดสอบ',
      }),
    ).resolves.toBe(true);
    await expect(store.consumeApproved('teacher-line', challenge.token)).resolves.toMatchObject({
      context: { schoolId: 10010002, bindingToken: 'binding-1', teacherName: 'ครูทดสอบ' },
    });
  });

  it('carries flow-specific context through to approval', async () => {
    const store = buildStore();
    const challenge = await store.create('teacher-line', 'invitation-1', {
      schoolId: 10010002,
      schoolName: 'โรงเรียนทดสอบ',
    });

    const authorization = await store.claim('teacher-line', challenge.token);
    const read = await store.readAuthorization('teacher-line', authorization!.authorizationToken);
    expect(read?.challenge.context).toEqual({
      schoolId: 10010002,
      schoolName: 'โรงเรียนทดสอบ',
    });
    expect(read?.minimumAuthenticatedAt).toBeGreaterThan(0);
  });
});
