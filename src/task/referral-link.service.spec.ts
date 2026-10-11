import { ReferralLinkService } from './referral-link.service';

describe('ReferralLinkService public history access', () => {
  function setup(verified: boolean) {
    const repository = {
      findReferralLinkByTokenHash: jest.fn().mockResolvedValue({
        id: 'fixture-link',
        case_id: 88,
        status_code: 'ACTIVE',
        case_status: 'AWAITING_REFERRAL_OUTCOME',
        has_result: false,
        starts_at: '2000-01-01T00:00:00Z',
        expires_at: '2099-01-01T00:00:00Z',
      }),
      findCaseForReferralLink: jest
        .fn()
        .mockResolvedValue({ id: 88, student_name: 'Fixture student' }),
      listPublicCaseContactChannels: jest.fn().mockResolvedValue([]),
      listStudentFollowUpHistory: jest.fn().mockResolvedValue([]),
    };
    const sessions = {
      readVerifiedClaims: jest
        .fn()
        .mockResolvedValue(
          verified
            ? { provider: 'ARAID', subject: 'FIXTURE_SUBJECT', name: 'Fixture reporter' }
            : null,
        ),
    };
    const service = new ReferralLinkService(
      repository as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      sessions as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
    );
    return { service, repository };
  }

  it('never loads student history before the link identity is verified', async () => {
    const { service, repository } = setup(false);
    await expect(service.getLink('FIXTURE_REFERRAL_TOKEN_PLACEHOLDER')).resolves.toMatchObject({
      data: { auth_required: true },
    });
    expect(repository.listStudentFollowUpHistory).not.toHaveBeenCalled();
  });

  it('uses only the authorized case school history after verification', async () => {
    const { service, repository } = setup(true);
    await expect(
      service.getLink('FIXTURE_REFERRAL_TOKEN_PLACEHOLDER', 'FIXTURE_SESSION_PLACEHOLDER'),
    ).resolves.toMatchObject({ data: { auth_required: false, follow_up_history: [] } });
    expect(repository.listStudentFollowUpHistory).toHaveBeenCalledWith(88, 5, { publicCase: true });
  });
});
