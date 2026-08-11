import { TeacherLineAraIdChallengeStore } from './teacher-line-araid-challenge.store';

describe('TeacherLineAraIdChallengeStore', () => {
  it('keeps a pending challenge until one approved result is consumed', async () => {
    const store = new TeacherLineAraIdChallengeStore({ getClient: () => undefined } as never);
    const challenge = await store.create({
      invitationId: '11111111-1111-4111-8111-111111111111',
      schoolId: 7,
      schoolName: 'โรงเรียนทดสอบ',
    });

    await expect(store.read(challenge.token)).resolves.toMatchObject({ status: 'PENDING' });
    const authorization = await store.claim(challenge.token);
    expect(authorization?.authorizationToken).toBeTruthy();
    await expect(store.readAuthorization(authorization!.authorizationToken)).resolves.toMatchObject(
      {
        status: 'CLAIMED',
      },
    );
    await expect(
      store.approveAuthorization(authorization!.authorizationToken, {
        bindingToken: 'binding-token',
        teacherName: 'สมชาย ใจดี',
      }),
    ).resolves.toBe(true);
    await expect(store.consumeApproved(challenge.token)).resolves.toMatchObject({
      status: 'APPROVED',
      bindingToken: 'binding-token',
    });
    await expect(store.consumeApproved(challenge.token)).resolves.toBeNull();
  });

  it('keeps a claimed authorization alive after the QR entry window closes', async () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-08-12T00:00:00.000Z'));
      const store = new TeacherLineAraIdChallengeStore({ getClient: () => undefined } as never);
      const challenge = await store.create({
        invitationId: '11111111-1111-4111-8111-111111111111',
        schoolId: 7,
        schoolName: 'โรงเรียนทดสอบ',
      });
      const authorization = await store.claim(challenge.token);
      expect(authorization).not.toBeNull();
      expect(authorization?.expiresAt).toBe(Date.now() + 600_000);

      jest.advanceTimersByTime(91_000);

      await expect(
        store.readAuthorization(authorization!.authorizationToken),
      ).resolves.toMatchObject({ status: 'CLAIMED' });
      await expect(store.claim(challenge.token)).resolves.toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('rejects an unclaimed challenge after the QR entry window closes', async () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-08-12T00:00:00.000Z'));
      const store = new TeacherLineAraIdChallengeStore({ getClient: () => undefined } as never);
      const challenge = await store.create({
        invitationId: '11111111-1111-4111-8111-111111111111',
        schoolId: 7,
        schoolName: 'โรงเรียนทดสอบ',
      });

      jest.advanceTimersByTime(91_000);

      await expect(store.read(challenge.token)).resolves.toBeNull();
      await expect(store.claim(challenge.token)).resolves.toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});
