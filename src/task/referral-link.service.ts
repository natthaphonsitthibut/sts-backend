import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
  Optional,
  UnauthorizedException,
  Inject,
  Logger,
} from '@nestjs/common';
import * as crypto from 'crypto';
import type { Readable } from 'stream';
import * as QRCode from 'qrcode';
import { clean, generateToken, hashToken } from '../common/utils/helpers';
import { resolveAuditActorId } from '../common/audit/audit-actor.util';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AraIdChallengeStore, type AraIdChallengeScope } from '../araid/araid-challenge.store';
import { AraIdService } from '../araid/araid.service';
import {
  MagicSessionStoreService,
  type MagicSessionClaims,
} from '../auth/magic-session-store.service';
import type { AuthenticatedRequestUser } from '../auth';
import { TokenEncryptionService } from '../common/crypto/token-encryption.service';
import { encodeMediaVersion } from '../common/utils/media-version.util';
import { buildStudentTermAddress } from '../common/utils/student-address.util';
import { FILE_STORAGE_ADAPTER, type FileStorageAdapter } from '../files/storage/file-storage.types';
import { StudentGeocodeCacheService } from '../student-geocode/student-geocode-cache.service';
import { CaseService } from './case.service';
import type {
  CancelReferralDto,
  ReferralLinkAccessCodeDto,
  SendReferralDto,
  SubmitReferralReportDto,
} from './dto/task.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { mapFollowUpHistoryRow } from './follow-up-history.mapper';
import { TaskPolicyService } from './task-policy.service';
import { TaskRepository } from './task.repository';

const ARAID_SCOPE: AraIdChallengeScope = 'referral-link';
/** Wrong codes allowed before the link locks and the school has to issue another. */
const MAX_ACCESS_CODE_ATTEMPTS = 5;
const ACCESS_CODE_DIGITS = 6;
/**
 * The identity provider the reporter proves who they are with. AraID stands in
 * for ThaID until the real one is wired (owner, 2026-10-08); everything stored
 * carries this code so the switch needs no schema change.
 */
const REPORTER_IDENTITY_PROVIDER = 'ARAID';

const PHOTO_CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

type ReferralLinkRow = Record<string, unknown>;
interface ReporterClaims {
  provider: string;
  subject: string;
  name: string;
}

function maskName(name: unknown): string {
  if (typeof name !== 'string' || !name.trim()) return '-';
  return name
    .trim()
    .split(/\s+/)
    .map((part) =>
      part.length <= 2 ? `${part[0]}*` : part[0] + '*'.repeat(part.length - 2) + part.at(-1),
    )
    .join(' ');
}

/** Sessions for referral links live beside the task links' in one store. */
function sessionSubject(linkId: string, revision = 0): string {
  return revision === 0 ? `referral-link:${linkId}` : `referral-link:${linkId}:code:${revision}`;
}

/**
 * The agency's side of a referral: a link the school issues for one referral,
 * opened with a code the school passes on separately, verified with AraID, and
 * used once to file the agency's report (tasks/task-agency-referral-report-link.md).
 *
 * The agency never gets an account. Everything it can reach hangs off the link
 * token, and everything it sees is what the teacher's home-visit link shows.
 */
@Injectable()
export class ReferralLinkService {
  private readonly logger = new Logger(ReferralLinkService.name);

  constructor(
    private readonly taskRepository: TaskRepository,
    private readonly taskPolicyService: TaskPolicyService,
    private readonly caseService: CaseService,
    private readonly notificationsService: NotificationsService,
    private readonly auditLog: AuditLogService,
    private readonly magicSessionStore: MagicSessionStoreService,
    private readonly araIdChallengeStore: AraIdChallengeStore,
    private readonly araIdService: AraIdService,
    private readonly tokenEncryption: TokenEncryptionService,
    @Inject(FILE_STORAGE_ADAPTER)
    private readonly storage: FileStorageAdapter,
    @Optional()
    private readonly geocodeCache?: StudentGeocodeCacheService,
  ) {}

  // ---------------------------------------------------------------- school

  /**
   * ส่งต่อ: the referral's มอบหมาย. Sends a case waiting in รอส่งต่อ to an
   * agency, issues the link and its access code, and moves the case to
   * รอผลการส่งต่อ. A case whose last referral's link ran out or locked before
   * any result can be sent again; that referral closes as ยกเลิก, like a
   * round whose link expired. The code stays bound to this link and can be viewed again by the school.
   */
  async sendReferral(caseId: number, body: SendReferralDto, actor?: AuthenticatedRequestUser) {
    const currentActor = this.assertCanManage(actor);
    const note = clean(body.referral_note) || null;
    if (!note) throw new BadRequestException('กรุณาระบุเหตุผลการส่งต่อ');
    const { startsAt, expiresAt } = this.parseWindow(body.starts_at, body.expires_at);
    const token = generateToken();
    const accessCode = crypto
      .randomInt(0, 10 ** ACCESS_CODE_DIGITS)
      .toString()
      .padStart(ACCESS_CODE_DIGITS, '0');
    const actorId = resolveAuditActorId(currentActor);

    const sent = await this.taskRepository.withTransaction(async (executor) => {
      const caseRow = await this.taskRepository.lockCaseForReferral(caseId, currentActor, executor);
      if (!caseRow) throw new NotFoundException('ไม่พบเคสนี้');
      const replacing = this.unansweredClosedReferral(caseRow);
      if (caseRow.status !== 'AWAITING_REFERRAL' && !replacing) {
        throw new ConflictException('ส่งต่อได้เฉพาะเคสที่รอส่งต่อ');
      }
      if (typeof caseRow.refer_review_id !== 'string') {
        throw new ConflictException('เคสนี้ยังไม่ได้พิจารณาให้ส่งต่อหน่วยงาน');
      }
      const agency = await this.taskRepository.findActiveReferralAgency(
        body.referral_agency_id,
        executor,
      );
      if (!agency) throw new BadRequestException('หน่วยงานส่งต่อไม่ถูกต้องหรือถูกปิดใช้งาน');
      if (replacing) {
        await this.taskRepository.closeUnansweredReferral(
          replacing.referralId,
          { reason: replacing.reason, cancelledByUserId: null },
          executor,
        );
      }
      const referralId = await this.taskRepository.insertCaseReferral(
        {
          reviewId: caseRow.refer_review_id,
          caseId,
          agencyId: body.referral_agency_id,
          referredByUserId: actorId,
          note,
        },
        executor,
      );
      const linkId = await this.taskRepository.insertReferralLink(
        {
          referralId,
          tokenHash: hashToken(token),
          tokenEncrypted: this.tokenEncryption.encrypt(token),
          accessCodeHash: this.hashAccessCode(token, accessCode),
          accessCodeEncrypted: this.tokenEncryption.encrypt(accessCode),
          startsAt,
          expiresAt,
          createdByUserId: actorId,
        },
        executor,
      );
      const moved = await this.taskRepository.setCaseStatus(
        caseId,
        {
          from: ['AWAITING_REFERRAL', 'AWAITING_REFERRAL_OUTCOME'],
          to: 'AWAITING_REFERRAL_OUTCOME',
          updatedByUserId: actorId,
        },
        executor,
      );
      if (!moved) throw new ConflictException('ส่งต่อได้เฉพาะเคสที่รอส่งต่อ');
      return { referralId, linkId, caseRow, replacedReferral: replacing };
    });

    await this.auditLog.record({
      actorUserId: actorId,
      actorLabel: this.actorLabel(currentActor),
      action: 'CASE_REFERRAL_LINK_ISSUE',
      targetType: 'case',
      targetId: String(caseId),
      metadata: {
        referralId: sent.referralId,
        linkId: sent.linkId,
        referralAgencyId: body.referral_agency_id,
        startsAt: startsAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        ...(sent.replacedReferral
          ? {
              replacedReferralId: sent.replacedReferral.referralId,
              replacementReason: sent.replacedReferral.reason,
            }
          : {}),
      },
      ip: null,
    });
    await this.notifyCaseStatus(caseId, sent.caseRow, 'AWAITING_REFERRAL_OUTCOME', actorId);

    return {
      success: true,
      data: {
        referral_id: sent.referralId,
        url: this.taskRepository.referralLinkUrl(token),
        access_code: accessCode,
        starts_at: startsAt.toISOString(),
        expires_at: expiresAt.toISOString(),
      },
    };
  }

  async getAccessCode(caseId: number, referralId: string, actor?: AuthenticatedRequestUser) {
    const currentActor = this.assertCanManage(actor);
    const row = await this.taskRepository.findReferralAccessCode(caseId, referralId, currentActor);
    if (!row) throw new NotFoundException('ไม่พบลิงก์ส่งต่อในเคสนี้');
    if (typeof row.access_code_encrypted !== 'string') {
      throw new ConflictException('ลิงก์เดิมไม่รองรับการดูรหัส กรุณายกเลิกและส่งต่อใหม่');
    }
    return {
      success: true,
      data: { access_code: this.tokenEncryption.decrypt(row.access_code_encrypted) },
    };
  }

  async refreshAccessCode(caseId: number, referralId: string, actor?: AuthenticatedRequestUser) {
    const currentActor = this.assertCanManage(actor);
    const actorId = resolveAuditActorId(currentActor);
    return await this.taskRepository.withTransaction(async (executor) => {
      const referral = await this.taskRepository.lockCaseReferralForResult(
        caseId,
        referralId,
        currentActor,
        executor,
      );
      this.assertReferralAwaitingResult(referral);
      const link = await this.taskRepository.lockLatestReferralAccessCode(referralId, executor);
      if (!link) throw new NotFoundException('ไม่พบลิงก์รายงานผลการส่งต่อ');
      if (link.status_code !== 'ACTIVE' || link.has_not_expired !== true) {
        throw new ConflictException('เปลี่ยนรหัสได้เฉพาะลิงก์ที่ยังใช้งานและยังไม่รายงาน');
      }
      const token = this.tokenEncryption.decrypt(String(link.token_encrypted));
      let code: string;
      do {
        code = crypto
          .randomInt(0, 10 ** ACCESS_CODE_DIGITS)
          .toString()
          .padStart(ACCESS_CODE_DIGITS, '0');
      } while (this.hashAccessCode(token, code) === link.access_code_hash);
      const revision = await this.taskRepository.rotateReferralAccessCode(
        String(link.id),
        this.hashAccessCode(token, code),
        this.tokenEncryption.encrypt(code),
        executor,
      );
      await this.auditLog.recordAtomic(
        {
          actorUserId: actorId,
          actorLabel: this.actorLabel(currentActor),
          action: 'CASE_REFERRAL_LINK_CODE_REFRESH',
          targetType: 'case',
          targetId: String(caseId),
          metadata: { referralId, linkId: link.id, accessCodeRevision: revision },
          ip: null,
        },
        executor,
      );
      return { success: true, data: { access_code: code } };
    });
  }

  /**
   * ยกเลิกการส่งต่อ: withdraws a sent referral nobody answered, like
   * ยกเลิกการมอบหมาย — its link dies, it reads ยกเลิก with the reason, and the
   * case goes back to รอส่งต่อ for the school to send again.
   */
  async cancelReferral(
    caseId: number,
    referralId: string,
    body: CancelReferralDto,
    actor?: AuthenticatedRequestUser,
  ) {
    const currentActor = this.assertCanManage(actor);
    const reason = clean(body.cancel_reason) || null;
    if (!reason) throw new BadRequestException('กรุณาระบุเหตุผลการยกเลิกการส่งต่อ');
    const actorId = resolveAuditActorId(currentActor);
    const referral = await this.taskRepository.withTransaction(async (executor) => {
      const locked = await this.taskRepository.lockCaseReferralForResult(
        caseId,
        referralId,
        currentActor,
        executor,
      );
      this.assertReferralAwaitingResult(locked);
      await this.taskRepository.closeUnansweredReferral(
        referralId,
        { reason, cancelledByUserId: actorId },
        executor,
      );
      await this.taskRepository.setCaseStatus(
        caseId,
        { from: ['AWAITING_REFERRAL_OUTCOME'], to: 'AWAITING_REFERRAL', updatedByUserId: actorId },
        executor,
      );
      return locked;
    });
    await this.auditLog.record({
      actorUserId: actorId,
      actorLabel: this.actorLabel(currentActor),
      action: 'CASE_REFERRAL_LINK_REVOKE',
      targetType: 'case',
      targetId: String(caseId),
      metadata: { referralId, cancelReason: reason },
      ip: null,
    });
    await this.notifyCaseStatus(caseId, referral, 'AWAITING_REFERRAL', actorId);
    return { success: true, data: { case_id: caseId, referral_id: referralId } };
  }

  // ---------------------------------------------------------------- agency

  /**
   * Checks the access code and, when it is right, starts the AraID challenge
   * that ends in the link's session. Wrong codes count against the link and the
   * last allowed one locks it.
   */
  async createAraIdChallenge(token: string, body: ReferralLinkAccessCodeDto, baseUrl: string) {
    const link = await this.findUsableLink(token);
    const linkId = String(link.id);
    if (!this.accessCodeMatches(token.trim(), body.access_code, link.access_code_hash)) {
      const failed = await this.taskRepository.recordFailedReferralLinkCode(
        linkId,
        MAX_ACCESS_CODE_ATTEMPTS,
      );
      await this.auditLog.record({
        actorUserId: null,
        actorLabel: null,
        action: failed?.locked ? 'CASE_REFERRAL_LINK_LOCK' : 'CASE_REFERRAL_LINK_CODE_FAIL',
        targetType: 'case',
        targetId: String(link.case_id),
        metadata: { linkId, attempts: failed?.attempts ?? null },
        ip: null,
      });
      if (!failed || failed.locked) {
        throw new ForbiddenException('กรอกรหัสผิดเกินกำหนด ลิงก์ถูกล็อก กรุณาติดต่อโรงเรียน');
      }
      throw new BadRequestException(
        `รหัสไม่ถูกต้อง (เหลืออีก ${MAX_ACCESS_CODE_ATTEMPTS - failed.attempts} ครั้ง)`,
      );
    }

    const challenge = await this.araIdChallengeStore.create(ARAID_SCOPE, linkId, {
      accessCodeRevision: Number(link.access_code_revision ?? 0),
    });
    const verificationUrl = new URL('/araid/authorize', baseUrl);
    verificationUrl.hash = `challenge=${encodeURIComponent(challenge.token)}&scope=${ARAID_SCOPE}`;
    const qrDataUrl = await QRCode.toDataURL(verificationUrl.toString(), {
      width: 320,
      margin: 2,
      errorCorrectionLevel: 'M',
    });
    return {
      success: true,
      data: {
        challengeToken: challenge.token,
        verificationUrl: verificationUrl.toString(),
        qrDataUrl,
        referenceCode: challenge.referenceCode,
        expiresAt: new Date(challenge.entryExpiresAt).toISOString(),
      },
    };
  }

  async beginAraIdChallenge(challengeToken: string, existingAuthorizationToken?: string) {
    if (existingAuthorizationToken) {
      const resumed = await this.araIdChallengeStore.resume(
        ARAID_SCOPE,
        challengeToken,
        existingAuthorizationToken,
      );
      if (resumed) {
        const challenge = await this.araIdChallengeStore.read(ARAID_SCOPE, challengeToken);
        if (!challenge) throw new GoneException('คำขอยืนยัน AraID หมดอายุแล้ว');
        await this.assertChallengeCurrent(challenge);
        return { authorizationToken: resumed.authorizationToken, expiresAt: resumed.expiresAt };
      }
    }
    const challenge = await this.araIdChallengeStore.read(ARAID_SCOPE, challengeToken);
    if (!challenge) throw new GoneException('คำขอยืนยัน AraID หมดอายุแล้ว');
    await this.assertChallengeCurrent(challenge);
    const authorization = await this.araIdChallengeStore.claimOrRenew(ARAID_SCOPE, challengeToken);
    if (!authorization) throw new GoneException('คำขอยืนยัน AraID ถูกเปิดใช้หรือหมดอายุแล้ว');
    return authorization;
  }

  /**
   * Anyone with a valid AraID may approve — the code already proved the school
   * sent them. What approval adds is who they are, carried into the session so
   * the report records it.
   */
  async approveAraIdChallenge(
    authorizationToken: string,
    araIdProfileId: string,
    authenticatedAt: number,
  ) {
    const authorization = await this.araIdChallengeStore.readAuthorization(
      ARAID_SCOPE,
      authorizationToken,
    );
    if (!authorization) throw new GoneException('การยืนยัน AraID หมดอายุแล้ว');
    if (authenticatedAt < authorization.minimumAuthenticatedAt) {
      throw new UnauthorizedException('กรุณากรอก PIN AraID ใหม่เพื่อยืนยันลิงก์นี้');
    }
    const linkId = authorization.challenge.subjectId;
    const link = await this.assertChallengeCurrent(authorization.challenge);
    const reporter = await this.resolveReporter(araIdProfileId);
    const approved = await this.araIdChallengeStore.approveAuthorization(
      ARAID_SCOPE,
      authorizationToken,
      { reporter },
    );
    if (!approved) throw new GoneException('คำขอยืนยัน AraID ถูกใช้หรือหมดอายุแล้ว');
    await this.auditLog.record({
      actorUserId: null,
      actorLabel: reporter.name,
      action: 'CASE_REFERRAL_LINK_VERIFY',
      targetType: 'case',
      targetId: String(link.case_id),
      metadata: { linkId, authMethod: 'ARAID_QR' },
      ip: null,
    });
    return { success: true, data: { approved: true } };
  }

  async pollAraIdChallenge(challengeToken: string) {
    const challenge = await this.araIdChallengeStore.read(ARAID_SCOPE, challengeToken);
    if (!challenge) throw new GoneException('คำขอยืนยัน AraID หมดอายุแล้ว');
    await this.assertChallengeCurrent(challenge);
    if (challenge.status === 'PENDING') {
      return { success: true, data: { status: 'PENDING' as const } };
    }
    if (challenge.status === 'CLAIMED') {
      return {
        success: true,
        data: {
          status: 'IN_PROGRESS' as const,
          expiresAt: new Date(challenge.expiresAt).toISOString(),
        },
      };
    }
    const consumed = await this.araIdChallengeStore.consumeApproved(ARAID_SCOPE, challengeToken);
    if (!consumed) throw new GoneException('คำขอยืนยัน AraID ถูกใช้แล้ว');
    const reporter = this.readReporter(consumed.context?.reporter);
    if (!reporter) throw new GoneException('คำขอยืนยัน AraID ไม่สมบูรณ์');
    const sessionToken = await this.magicSessionStore.issue(
      sessionSubject(consumed.subjectId, Number(consumed.context?.accessCodeRevision ?? 0)),
      {
        ...reporter,
      },
    );
    return { success: true, data: { status: 'APPROVED' as const, sessionToken } };
  }

  /**
   * What the agency's page shows. Before the code and AraID it is only enough
   * to recognise the link (masked name, agency, dates); after, it is what the
   * teacher's home-visit link shows plus the referral itself.
   */
  async getLink(token: string, sessionToken?: string) {
    const link = await this.findUsableLink(token);
    const reporter = await this.readSessionReporter(link, sessionToken);
    const caseData = await this.taskRepository.findCaseForReferralLink(Number(link.case_id));
    const referral = {
      agency_name: link.agency_name ?? null,
      agency_kind_label: link.agency_kind_label ?? null,
      starts_at: link.starts_at ?? null,
      expires_at: link.expires_at ?? null,
    };
    if (!reporter) {
      return {
        success: true,
        data: {
          auth_required: true,
          referral,
          student_name: maskName(caseData?.student_name),
          student_school: maskName(caseData?.student_school),
        },
      };
    }

    const caseId = Number(caseData?.id);
    let studentLat = caseData?.student_lat ?? null;
    let studentLng = caseData?.student_lng ?? null;
    let approximate = false;
    // The same fallback the follow-up link uses when the case has no pin.
    if (
      (studentLat === null || studentLng === null) &&
      typeof caseData?.student_uuid === 'string' &&
      this.geocodeCache
    ) {
      const address = buildStudentTermAddress(caseData);
      const resolved = address
        ? await this.geocodeCache.resolve(caseData.student_uuid, address)
        : null;
      if (resolved) {
        studentLat = resolved.lat;
        studentLng = resolved.lng;
        approximate = true;
      }
    }
    return {
      success: true,
      data: {
        auth_required: false,
        reporter_name: reporter.name,
        referral: {
          ...referral,
          referred_by: link.referred_by ?? null,
          referred_at: link.referred_at ?? null,
          referral_note: link.referral_note ?? null,
        },
        student_name: caseData?.student_name ?? null,
        student_school: caseData?.student_school ?? null,
        student_grade: caseData?.grade ?? null,
        student_room: caseData?.room ?? null,
        student_photo_url:
          typeof caseData?.student_photo_storage_key === 'string'
            ? `/api/referral-links/${encodeURIComponent(token)}/student-photo?v=${encodeMediaVersion(
                caseData.student_photo_updated_at,
              )}`
            : null,
        student_address: caseData?.student_address ?? null,
        address_line: caseData?.address_line ?? null,
        address_province: caseData?.address_province ?? null,
        address_district: caseData?.address_district ?? null,
        address_sub_district: caseData?.address_sub_district ?? null,
        postal_code: caseData?.postal_code ?? null,
        student_phone: caseData?.student_phone ?? null,
        student_lat: studentLat,
        student_lng: studentLng,
        is_approximate_home_location: approximate,
        reason_flagged: caseData?.reason_flagged ?? null,
        case_display_status_label: caseData?.display_status_label ?? null,
        contact_channels: Number.isInteger(caseId)
          ? (await this.taskRepository.listPublicCaseContactChannels(caseId)).map((row) => ({
              contact_kind: row.contact_kind === 'STUDENT' ? 'STUDENT' : 'GUARDIAN',
              relation: typeof row.relation === 'string' ? row.relation : null,
              relation_note: typeof row.relation_note === 'string' ? row.relation_note : null,
              full_name: typeof row.full_name === 'string' ? row.full_name : null,
              phone: typeof row.phone === 'string' ? row.phone : null,
              is_primary: row.is_primary === true,
            }))
          : [],
        follow_up_history: Number.isInteger(caseId)
          ? (
              await this.taskRepository.listStudentFollowUpHistory(caseId, 5, { publicCase: true })
            ).map(mapFollowUpHistoryRow)
          : [],
      },
    };
  }

  async resolveStudentPhoto(
    token: string,
    sessionToken?: string,
  ): Promise<{ stream: Readable; contentType: string }> {
    const link = await this.findUsableLink(token);
    if (!(await this.readSessionReporter(link, sessionToken))) {
      throw new NotFoundException('ไม่พบรูปประจำตัวนักเรียน');
    }
    const caseData = await this.taskRepository.findCaseForReferralLink(Number(link.case_id));
    const storageKey = caseData?.student_photo_storage_key;
    if (typeof storageKey !== 'string' || !storageKey) {
      throw new NotFoundException('ไม่พบรูปประจำตัวนักเรียน');
    }
    const contentType = PHOTO_CONTENT_TYPES[storageKey.split('.').at(-1)?.toLowerCase() ?? ''];
    const stream = contentType ? await this.storage.open(storageKey) : null;
    if (!contentType || !stream) throw new NotFoundException('ไม่พบรูปประจำตัวนักเรียน');
    return { stream, contentType };
  }

  /** Files the agency report once: success awaits review; failure becomes ส่งต่อไม่สำเร็จ. */
  async submitReport(token: string, body: SubmitReferralReportDto, sessionToken?: string) {
    const link = await this.findUsableLink(token);
    const reporter = await this.readSessionReporter(link, sessionToken);
    if (!reporter) throw new UnauthorizedException('กรุณายืนยันตัวตนก่อนส่งรายงาน');
    const note = clean(body.result_note) || null;
    if (!note) throw new BadRequestException('กรุณาสรุปผลการดำเนินการ');
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
    if (body.action_date > today) {
      throw new BadRequestException('วันที่ดำเนินการต้องไม่เกินวันนี้');
    }
    await this.caseService.applyReferralResult({
      caseId: Number(link.case_id),
      referralId: String(link.case_referral_id),
      resultCode: body.result_code,
      note,
      scopeActor: null,
      recordedByUserId: null,
      agencyReport: {
        linkId: String(link.id),
        accessCodeRevision: Number(link.access_code_revision ?? 0),
        actionDate: body.action_date,
        identityProviderCode: reporter.provider,
        providerSubject: reporter.subject,
        reporterName: reporter.name,
      },
      audit: {
        actorUserId: null,
        actorLabel: `${reporter.name} (${typeof link.agency_name === 'string' ? link.agency_name : 'หน่วยงาน'})`,
      },
    });
    return { success: true };
  }

  // --------------------------------------------------------------- helpers

  private assertCanManage(actor?: AuthenticatedRequestUser) {
    const currentActor = this.taskPolicyService.ensureActor(actor);
    if (!this.taskPolicyService.hasPermission(currentActor, 'case:manage')) {
      throw new ForbiddenException('ไม่มีสิทธิ์จัดการลิงก์ส่งต่อ');
    }
    return currentActor;
  }

  private parseWindow(rawStartsAt: string, rawExpiresAt: string) {
    const startsAt = new Date(rawStartsAt);
    const expiresAt = new Date(rawExpiresAt);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(expiresAt.getTime())) {
      throw new BadRequestException('วันเวลาของลิงก์ไม่ถูกต้อง');
    }
    if (expiresAt <= startsAt) throw new BadRequestException('วันสิ้นสุดต้องหลังวันเริ่ม');
    if (expiresAt <= new Date()) throw new BadRequestException('วันสิ้นสุดต้องเป็นเวลาในอนาคต');
    return { startsAt, expiresAt };
  }

  /**
   * The case's last referral when its round is over without an answer — its
   * link locked or ran out — so a new send replaces it. A referral whose link
   * still opens, or that has a result, is not replaceable.
   */
  private unansweredClosedReferral(
    caseRow: Record<string, unknown>,
  ): { referralId: string; reason: string } | null {
    if (
      caseRow.status !== 'AWAITING_REFERRAL_OUTCOME' ||
      typeof caseRow.latest_referral_id !== 'string' ||
      caseRow.latest_has_result === true
    ) {
      return null;
    }
    if (caseRow.latest_link_status == null && caseRow.latest_referral_status === 'REFERRED') {
      return {
        referralId: caseRow.latest_referral_id,
        reason: 'การส่งต่อเดิมยังไม่มีลิงก์รายงานผล',
      };
    }
    if (caseRow.latest_link_status === 'LOCKED') {
      return {
        referralId: caseRow.latest_referral_id,
        reason: 'ลิงก์ถูกล็อกเพราะกรอกรหัสผิดเกินกำหนด',
      };
    }
    if (
      caseRow.latest_link_status === 'ACTIVE' &&
      new Date(String(caseRow.latest_link_expires_at)) <= new Date()
    ) {
      return {
        referralId: caseRow.latest_referral_id,
        reason: 'ลิงก์หมดอายุโดยหน่วยงานยังไม่ได้รายงานผล',
      };
    }
    return null;
  }

  private async notifyCaseStatus(
    caseId: number,
    row: Record<string, unknown> | null | undefined,
    nextStatus: string,
    actorUserId: number | null,
  ): Promise<void> {
    try {
      await this.notificationsService.notifyCaseStatusChanged({
        caseId,
        studentName: typeof row?.student_name === 'string' ? row.student_name : null,
        schoolId: row?.school_id == null ? null : Number(row.school_id),
        nextStatus,
        completionOutcomeCode: null,
        actorUserId,
      });
    } catch (error) {
      // A missed notification must not undo a referral that was sent.
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to notify referral status after commit: ${message}`);
    }
  }

  private assertReferralAwaitingResult(referral: Record<string, unknown> | null): void {
    if (!referral) throw new NotFoundException('ไม่พบการส่งต่อนี้');
    if (referral.has_result === true) {
      throw new ConflictException('การส่งต่อนี้บันทึกผลแล้ว');
    }
    if (referral.is_latest !== true || referral.case_status !== 'AWAITING_REFERRAL_OUTCOME') {
      throw new ConflictException('เคสนี้ไม่ได้รอผลการส่งต่อนี้แล้ว');
    }
  }

  private async assertChallengeCurrent(challenge: {
    subjectId: string;
    context: Record<string, unknown>;
  }): Promise<ReferralLinkRow> {
    const link = await this.taskRepository.findReferralLinkById(challenge.subjectId);
    this.assertLinkUsable(link);
    if (
      Number(challenge.context.accessCodeRevision ?? 0) !== Number(link.access_code_revision ?? 0)
    ) {
      throw new GoneException('รหัสเปลี่ยนแล้ว กรุณากรอกรหัสใหม่และยืนยัน AraID อีกครั้ง');
    }
    return link;
  }

  private async findUsableLink(token: string): Promise<ReferralLinkRow> {
    const trimmed = token.trim();
    if (trimmed.length < 32 || trimmed.length > 256) {
      throw new NotFoundException('ไม่พบลิงก์หรือลิงก์ไม่ถูกต้อง');
    }
    const link = await this.taskRepository.findReferralLinkByTokenHash(hashToken(trimmed));
    this.assertLinkUsable(link);
    return link;
  }

  private assertLinkUsable(link: ReferralLinkRow | null): asserts link is ReferralLinkRow {
    if (!link) throw new NotFoundException('ไม่พบลิงก์หรือลิงก์ไม่ถูกต้อง');
    switch (link.status_code) {
      case 'USED':
        throw new ConflictException('ลิงก์นี้ส่งรายงานเรียบร้อยแล้ว');
      case 'LOCKED':
        throw new ForbiddenException('ลิงก์นี้ถูกล็อก กรุณาติดต่อโรงเรียน');
      case 'REVOKED':
        throw new GoneException('ลิงก์นี้ถูกยกเลิกแล้ว');
      case 'ACTIVE':
        break;
      default:
        throw new GoneException('ลิงก์นี้ใช้งานไม่ได้แล้ว');
    }
    if (new Date(String(link.expires_at)) <= new Date()) {
      throw new GoneException('ลิงก์นี้หมดอายุแล้ว');
    }
    if (new Date(String(link.starts_at)) > new Date()) {
      throw new ForbiddenException('ลิงก์นี้ยังไม่เปิดใช้งาน');
    }
    if (link.has_result === true || link.case_status !== 'AWAITING_REFERRAL_OUTCOME') {
      throw new ConflictException('การส่งต่อนี้มีผลแล้ว');
    }
  }

  /** Salted with the token, so a leaked database alone cannot brute-force six digits. */
  private hashAccessCode(token: string, accessCode: string): string {
    return hashToken(`${token}:${accessCode}`);
  }

  private accessCodeMatches(token: string, accessCode: string, storedHash: unknown): boolean {
    if (typeof storedHash !== 'string') return false;
    const expected = Buffer.from(storedHash);
    const provided = Buffer.from(this.hashAccessCode(token, accessCode));
    return expected.length === provided.length && crypto.timingSafeEqual(expected, provided);
  }

  private async resolveReporter(araIdProfileId: string): Promise<ReporterClaims> {
    const claim = await this.araIdService.getVerifiedIdentityClaim(araIdProfileId);
    const profile = await this.araIdService.getSessionProfile(araIdProfileId);
    // ชื่อ นามสกุล only (owner, 2026-10-15): the title is not part of the name.
    const name = [profile.givenNameTh, profile.familyNameTh]
      .filter((part) => typeof part === 'string' && part.trim())
      .join(' ')
      .trim();
    return {
      provider: REPORTER_IDENTITY_PROVIDER,
      subject: claim.providerSubject,
      name: name || '-',
    };
  }

  private readReporter(value: unknown): ReporterClaims | null {
    if (!value || typeof value !== 'object') return null;
    const { provider, subject, name } = value as Record<string, unknown>;
    return typeof provider === 'string' && typeof subject === 'string' && typeof name === 'string'
      ? { provider, subject, name }
      : null;
  }

  private async readSessionReporter(
    link: ReferralLinkRow,
    sessionToken?: string,
  ): Promise<ReporterClaims | null> {
    const claims: MagicSessionClaims | null = await this.magicSessionStore.readVerifiedClaims(
      sessionSubject(String(link.id), Number(link.access_code_revision ?? 0)),
      sessionToken,
    );
    return claims ? this.readReporter(claims) : null;
  }

  private actorLabel(actor: AuthenticatedRequestUser): string | null {
    const name = [actor.FirstName, actor.LastName].filter(Boolean).join(' ').trim();
    return name || actor.username || null;
  }
}
