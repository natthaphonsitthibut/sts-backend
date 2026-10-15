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

describe('ReferralLinkService report action time', () => {
  const TOKEN = 'FIXTURE_REFERRAL_TOKEN_PLACEHOLDER_0001';
  function setup() {
    const repository = {
      findReferralLinkByTokenHash: jest.fn().mockResolvedValue({
        id: 'fixture-link',
        case_id: 88,
        case_referral_id: 'fixture-referral',
        status_code: 'ACTIVE',
        case_status: 'AWAITING_REFERRAL_OUTCOME',
        has_result: false,
        access_code_revision: 0,
        agency_name: 'Fixture agency',
        referred_at: '2026-10-15T03:00:00.000Z',
        starts_at: '2000-01-01T00:00:00Z',
        expires_at: '2099-01-01T00:00:00Z',
      }),
    };
    const caseService = { applyReferralResult: jest.fn().mockResolvedValue({ data: {} }) };
    const sessions = {
      readVerifiedClaims: jest.fn().mockResolvedValue({
        provider: 'ARAID',
        subject: 'FIXTURE_SUBJECT',
        name: 'Fixture reporter',
      }),
    };
    const service = new ReferralLinkService(
      repository as never,
      undefined as never,
      caseService as never,
      undefined as never,
      undefined as never,
      sessions as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
    );
    return { service, caseService };
  }
  const report = (action_at: string) => ({
    result_code: 'SUCCEEDED' as const,
    result_note: 'ดำเนินการเรียบร้อย',
    action_at,
  });

  it('refuses an action time in the future', async () => {
    const { service, caseService } = setup();
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await expect(service.submitReport(TOKEN, report(future), 'session')).rejects.toThrow(
      'วันและเวลาที่ดำเนินการต้องไม่อยู่ในอนาคต',
    );
    expect(caseService.applyReferralResult).not.toHaveBeenCalled();
  });

  it('refuses an action time before the referral was sent', async () => {
    const { service, caseService } = setup();
    await expect(
      service.submitReport(TOKEN, report('2026-10-15T09:59:00+07:00'), 'session'),
    ).rejects.toThrow('วันและเวลาที่ดำเนินการต้องไม่อยู่ก่อนเวลาที่ส่งต่อ');
    expect(caseService.applyReferralResult).not.toHaveBeenCalled();
  });

  it('files a valid action time as an ISO instant', async () => {
    const { service, caseService } = setup();
    await service.submitReport(TOKEN, report('2026-10-15T10:30:00+07:00'), 'session');
    const [input] = caseService.applyReferralResult.mock.calls[0] as [
      { agencyReport: { actionAt: string } },
    ];
    expect(input.agencyReport.actionAt).toBe('2026-10-15T03:30:00.000Z');
  });
});
