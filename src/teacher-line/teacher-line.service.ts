import { randomBytes, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { QueryRunner } from 'typeorm';
import * as QRCode from 'qrcode';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AraIdService } from '../araid/araid.service';
import { TokenEncryptionService } from '../common/crypto/token-encryption.service';
import { MESSAGING_PROVIDER, type MessagingProvider } from '../common/messaging/messaging.types';
import { hashToken } from '../common/utils/helpers';
import { appConfig } from '../config/app.config';
import { lineConfig } from '../config/line.config';
import { googleLoginConfig } from '../config/google-login.config';
import { GoogleOidcProvider } from '../classroom-attendance-links/google-oidc.provider';
import { ScopedGoogleLoginStateStore } from '../google-login/scoped-google-login-state.store';
import { TeacherLineRepository } from './teacher-line.repository';
import {
  type AraIdChallenge as StoredTeacherLineAraIdChallenge,
  AraIdChallengeStore,
  type AraIdChallengeScope,
} from '../araid/araid-challenge.store';

/** Every AraID challenge in this service belongs to the LINE-invitation flow. */
const ARAID_SCOPE: AraIdChallengeScope = 'teacher-line';

/** What this flow stores in the shared challenge's context bag. */
interface TeacherLineChallengeContext {
  schoolId: number;
  schoolName: string;
  bindingToken?: string;
  teacherName?: string;
}

function readLineContext(context: Record<string, unknown>): TeacherLineChallengeContext {
  return context as unknown as TeacherLineChallengeContext;
}
import { TeacherLineSessionStore } from './teacher-line-session.store';
import type { TeacherLineGroupInvitationRow, TeacherLineLinkOutcome } from './teacher-line.types';

@Injectable()
export class TeacherLineService {
  private readonly logger = new Logger(TeacherLineService.name);

  constructor(
    private readonly repository: TeacherLineRepository,
    private readonly sessionStore: TeacherLineSessionStore,
    private readonly tokenEncryption: TokenEncryptionService,
    private readonly auditLog: AuditLogService,
    private readonly araIdService: AraIdService,
    private readonly araIdChallengeStore: AraIdChallengeStore,
    @Inject(MESSAGING_PROVIDER)
    private readonly messaging: MessagingProvider,
    @Inject(lineConfig.KEY)
    private readonly line: ConfigType<typeof lineConfig>,
    @Inject(appConfig.KEY)
    private readonly app: ConfigType<typeof appConfig>,
    private readonly google: GoogleOidcProvider,
    private readonly googleStates: ScopedGoogleLoginStateStore,
    @Inject(googleLoginConfig.KEY)
    private readonly googleConfig: ConfigType<typeof googleLoginConfig>,
  ) {}

  isEnabled(): boolean {
    return this.messaging.isEnabled();
  }

  private assertEnabled(): void {
    if (!this.messaging.isEnabled()) {
      throw new ServiceUnavailableException('ระบบเชื่อมบัญชี LINE ยังไม่เปิดใช้งาน');
    }
  }

  private frontendBaseUrl(): string {
    if (!this.app.frontendBaseUrl) {
      throw new ServiceUnavailableException('ระบบเชื่อมบัญชี LINE ยังตั้งค่าไม่ครบ');
    }
    return this.app.frontendBaseUrl;
  }

  async issueGroupInvitation(input: {
    schoolId: number;
    schoolName: string;
    issuedBy: number;
    startsAt: Date;
    expiresAt: Date;
    baseUrl: string;
  }): Promise<{
    id: string;
    schoolId: number;
    schoolName: string;
    url: string;
    startsAt: string;
    expiresAt: string;
    status: 'PENDING' | 'ACTIVE';
  }> {
    this.assertEnabled();
    const { startsAt, expiresAt } = this.validateGroupInvitationTiming(
      input.startsAt,
      input.expiresAt,
    );
    const rawToken = randomBytes(32).toString('hex');
    const created = await this.repository.createGroupInvitation({
      schoolId: input.schoolId,
      schoolName: input.schoolName,
      issuedBy: input.issuedBy,
      startsAt: new Date(startsAt),
      expiresAt: new Date(expiresAt),
      tokenHash: hashToken(rawToken),
      tokenEncrypted: this.tokenEncryption.encrypt(rawToken),
    });
    if (!created) {
      throw new ConflictException('โรงเรียนนี้มีลิงก์ยืนยัน LINE ที่ยังใช้งานอยู่แล้ว');
    }
    const { id } = created;
    const url = new URL('/line-link', input.baseUrl);
    url.hash = `token=${encodeURIComponent(rawToken)}`;
    return {
      id,
      schoolId: input.schoolId,
      schoolName: input.schoolName,
      url: url.toString(),
      startsAt: new Date(startsAt).toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
      status: new Date(startsAt).getTime() > Date.now() ? 'PENDING' : 'ACTIVE',
    };
  }

  async getActiveGroupInvitation(
    schoolId: number,
    baseUrl: string,
  ): Promise<{
    id: string;
    schoolId: number;
    schoolName: string;
    url: string;
    startsAt: string;
    expiresAt: string;
    status: 'PENDING' | 'ACTIVE';
  } | null> {
    const invitation = await this.repository.findActiveGroupInvitationForSchool(schoolId);
    if (!invitation) return null;
    const shareToken = this.decryptGroupInvitationToken(invitation);
    if (!shareToken) return null;
    const url = new URL('/line-link', baseUrl);
    url.hash = `token=${encodeURIComponent(shareToken)}`;
    return {
      id: invitation.id,
      schoolId: invitation.school_id,
      schoolName: invitation.school_name,
      url: url.toString(),
      startsAt: new Date(invitation.starts_at).toISOString(),
      expiresAt: new Date(invitation.expires_at).toISOString(),
      status: new Date(invitation.starts_at).getTime() > Date.now() ? 'PENDING' : 'ACTIVE',
    };
  }

  async revokeGroupInvitation(id: string, schoolId: number, revokedBy: number): Promise<boolean> {
    return await this.repository.revokeActiveGroupInvitation(id, schoolId, revokedBy);
  }

  async updateGroupInvitation(input: {
    id: string;
    schoolId: number;
    startsAt: Date;
    expiresAt: Date;
    baseUrl: string;
  }): Promise<{
    id: string;
    schoolId: number;
    schoolName: string;
    url: string;
    startsAt: string;
    expiresAt: string;
    status: 'PENDING' | 'ACTIVE';
  }> {
    this.assertEnabled();
    const { startsAt, expiresAt } = this.validateGroupInvitationTiming(
      input.startsAt,
      input.expiresAt,
    );
    const updated = await this.repository.updateActiveGroupInvitation(
      input.id,
      input.schoolId,
      new Date(startsAt),
      new Date(expiresAt),
    );
    if (!updated) throw new GoneException('ลิงก์ยืนยัน LINE ถูกปิดหรือหมดอายุแล้ว');
    const invitation = await this.getActiveGroupInvitation(input.schoolId, input.baseUrl);
    if (!invitation) throw new GoneException('ลิงก์ยืนยัน LINE ถูกปิดหรือหมดอายุแล้ว');
    return invitation;
  }

  private decryptGroupInvitationToken(invitation: TeacherLineGroupInvitationRow): string | null {
    try {
      return this.tokenEncryption.decrypt(invitation.token_encrypted);
    } catch {
      this.logger.error(`Unable to decrypt active LINE group invitation ${invitation.id}`);
      return null;
    }
  }

  private validateGroupInvitationTiming(
    startsAtInput: Date,
    expiresAtInput: Date,
  ): { startsAt: number; expiresAt: number } {
    const now = Date.now();
    const startsAt = startsAtInput.getTime();
    const expiresAt = expiresAtInput.getTime();
    const maximumDurationMs = 366 * 24 * 60 * 60 * 1000;
    if (!Number.isFinite(startsAt) || !Number.isFinite(expiresAt)) {
      throw new BadRequestException('วันเวลาเริ่มหรือหมดอายุไม่ถูกต้อง');
    }
    if (expiresAt <= startsAt || expiresAt <= now) {
      throw new BadRequestException('วันหมดอายุต้องอยู่หลังวันเริ่มและยังไม่ผ่านไปแล้ว');
    }
    if (expiresAt - startsAt > maximumDurationMs || expiresAt - now > maximumDurationMs) {
      throw new BadRequestException('ลิงก์ยืนยัน LINE กำหนดอายุได้ไม่เกิน 1 ปี');
    }
    return { startsAt, expiresAt };
  }

  async resolveGroupInvitation(rawToken: string): Promise<{
    schoolId: number;
    schoolName: string;
    startsAt: string;
    expiresAt: string;
    status: 'PENDING' | 'ACTIVE';
  }> {
    this.assertEnabled();
    const invitation = await this.repository.findActiveGroupInvitationByTokenHash(
      hashToken(rawToken.trim()),
    );
    if (!invitation) {
      throw new GoneException('ลิงก์ยืนยัน LINE ไม่ถูกต้องหรือหมดอายุแล้ว');
    }
    return {
      schoolId: invitation.school_id,
      schoolName: invitation.school_name,
      startsAt: new Date(invitation.starts_at).toISOString(),
      expiresAt: new Date(invitation.expires_at).toISOString(),
      status: new Date(invitation.starts_at).getTime() > Date.now() ? 'PENDING' : 'ACTIVE',
    };
  }

  private async assertGroupInvitationActive(rawToken: string) {
    const invitation = await this.repository.findActiveGroupInvitationByTokenHash(
      hashToken(rawToken.trim()),
    );
    if (!invitation) {
      throw new GoneException('ลิงก์ยืนยัน LINE ไม่ถูกต้องหรือหมดอายุแล้ว');
    }
    if (new Date(invitation.starts_at).getTime() > Date.now()) {
      throw new BadRequestException('ลิงก์ยืนยัน LINE ยังไม่ถึงเวลาเริ่มใช้งาน');
    }
    return invitation;
  }

  async startGroupGoogleAuthorization(rawToken: string): Promise<string> {
    this.assertEnabled();
    const invitation = await this.assertGroupInvitationActive(rawToken);
    const login = await this.googleStates.create('teacher-line-group', {
      subjectId: invitation.id,
      tokenHash: invitation.token_hash,
      schoolId: invitation.school_id,
    });
    return this.google.authorizationUrl(
      login.state,
      login.nonce,
      this.googleConfig.teacherLineCallbackUrl,
    );
  }

  async developmentGroupGoogleAuthorization(rawToken: string, email: string): Promise<string> {
    this.assertEnabled();
    const identity = this.google.developmentIdentity(email);
    const invitation = await this.assertGroupInvitationActive(rawToken);
    const bindingToken = await this.createGroupGoogleBinding(invitation.school_id, identity.email);
    return await this.startAuthorization(bindingToken);
  }

  async completeGoogleAuthorization(code: string, state: string): Promise<string> {
    this.assertEnabled();
    const login = await this.googleStates.consume('teacher-line-group', state);
    if (!login) throw new GoneException('คำขอ Google Login หมดอายุหรือถูกใช้แล้ว');

    const identity = await this.google.exchange(
      code,
      login.nonce,
      this.googleConfig.teacherLineCallbackUrl,
    );
    const invitation = await this.repository.findActiveGroupInvitationByTokenHash(login.tokenHash);
    if (
      !invitation ||
      invitation.id !== login.subjectId ||
      invitation.school_id !== login.schoolId ||
      new Date(invitation.starts_at).getTime() > Date.now()
    ) {
      throw new GoneException('ลิงก์ยืนยัน LINE ถูกปิดหรือหมดอายุแล้ว');
    }
    const bindingToken = await this.createGroupGoogleBinding(login.schoolId, identity.email);
    return await this.startAuthorization(bindingToken);
  }

  private async createGroupGoogleBinding(schoolId: number, email: string): Promise<string> {
    const teacher = await this.repository.findActiveTeacherByEmail(email, schoolId);
    if (!teacher) {
      throw new ForbiddenException('Google นี้ไม่ตรงกับครูที่เปิดใช้งานในโรงเรียนนี้');
    }
    await this.assertTeacherLineAvailable(teacher.teacher_id);
    return await this.sessionStore.createBindingSession({
      teacherId: teacher.teacher_id,
      schoolId,
      verificationMethod: 'GOOGLE',
    });
  }

  private async assertTeacherLineAvailable(teacherId: string): Promise<void> {
    if (await this.repository.hasActiveAccountForTeacher(teacherId, this.line.messagingChannelId)) {
      throw new ConflictException(
        'บัญชีนี้เชื่อม LINE แล้ว หากต้องการเปลี่ยนกรุณาติดต่อผู้ดูแลระบบ',
      );
    }
  }

  async verifyAraId(
    groupToken: string,
    araIdProfileId: string,
  ): Promise<{ bindingToken: string; teacherName: string }> {
    this.assertEnabled();
    const invitation = await this.assertGroupInvitationActive(groupToken);
    const citizenId = await this.araIdService.getVerifiedIdentityNumber(araIdProfileId);
    const teacher = await this.repository.findActiveTeacherByCitizenId(
      citizenId,
      invitation.school_id,
    );
    if (!teacher) throw new BadRequestException('ไม่พบข้อมูลครูที่ตรงกับ AraID ในโรงเรียนนี้');
    if (
      await this.repository.hasActiveAccountForTeacher(
        teacher.teacher_id,
        this.line.messagingChannelId,
      )
    ) {
      throw new ConflictException(
        'บัญชีนี้เชื่อม LINE แล้ว หากต้องการเปลี่ยนกรุณาติดต่อผู้ดูแลระบบ',
      );
    }
    const bindingToken = await this.sessionStore.createBindingSession({
      teacherId: teacher.teacher_id,
      schoolId: invitation.school_id,
      verificationMethod: 'ARAID',
    });
    await this.auditLog.record({
      actorUserId: null,
      actorLabel: 'line-link',
      action: 'TEACHER_ACCESS_ARAID_VERIFY',
      targetType: 'teachers',
      targetId: teacher.teacher_id,
      metadata: { via: 'LINE_LINK', schoolId: invitation.school_id, authMethod: 'ARAID' },
      ip: null,
    });
    return {
      bindingToken,
      teacherName: `${teacher.first_name} ${teacher.last_name}`.trim(),
    };
  }

  async createAraIdChallenge(groupToken: string) {
    this.assertEnabled();
    const invitation = await this.assertGroupInvitationActive(groupToken);
    const challenge = await this.araIdChallengeStore.create(ARAID_SCOPE, invitation.id, {
      schoolId: invitation.school_id,
      schoolName: invitation.school_name,
    });
    return this.presentAraIdChallenge(challenge.token, challenge);
  }

  async getAraIdChallenge(challengeToken: string) {
    this.assertEnabled();
    const challenge = await this.readActiveAraIdChallenge(challengeToken);
    return this.presentAraIdChallenge(challengeToken, challenge);
  }

  async beginAraIdChallenge(challengeToken: string) {
    this.assertEnabled();
    await this.readActiveAraIdChallenge(challengeToken);
    const authorization = await this.araIdChallengeStore.claimOrRenew(ARAID_SCOPE, challengeToken);
    if (!authorization) throw new GoneException('คำขอยืนยัน AraID ถูกเปิดใช้หรือหมดอายุแล้ว');
    return {
      authorizationToken: authorization.authorizationToken,
      expiresAt: new Date(authorization.expiresAt),
    };
  }

  async approveAraIdChallenge(authorizationToken: string, araIdProfileId: string): Promise<void> {
    this.assertEnabled();
    const authorization = await this.araIdChallengeStore.readAuthorization(
      ARAID_SCOPE,
      authorizationToken,
    );
    if (!authorization) throw new GoneException('การยืนยัน AraID หมดอายุแล้ว');
    const challenge = readLineContext(authorization.challenge.context);
    const active = await this.repository.findActiveGroupInvitationForSchool(challenge.schoolId);
    if (
      !active ||
      active.id !== authorization.challenge.subjectId ||
      new Date(active.starts_at).getTime() > Date.now()
    ) {
      throw new GoneException('ลิงก์ยืนยัน LINE ถูกปิดหรือหมดอายุแล้ว');
    }
    const citizenId = await this.araIdService.getVerifiedIdentityNumber(araIdProfileId);
    const teacher = await this.repository.findActiveTeacherByCitizenId(
      citizenId,
      challenge.schoolId,
    );
    if (!teacher) throw new BadRequestException('ไม่พบข้อมูลครูที่ตรงกับ AraID ในโรงเรียนนี้');
    if (
      await this.repository.hasActiveAccountForTeacher(
        teacher.teacher_id,
        this.line.messagingChannelId,
      )
    ) {
      throw new ConflictException(
        'บัญชีนี้เชื่อม LINE แล้ว หากต้องการเปลี่ยนกรุณาติดต่อผู้ดูแลระบบ',
      );
    }
    const bindingToken = await this.sessionStore.createBindingSession({
      teacherId: teacher.teacher_id,
      schoolId: challenge.schoolId,
      verificationMethod: 'ARAID',
    });
    const approved = await this.araIdChallengeStore.approveAuthorization(
      ARAID_SCOPE,
      authorizationToken,
      {
        bindingToken,
        teacherName: `${teacher.first_name} ${teacher.last_name}`.trim(),
      },
    );
    if (!approved) throw new GoneException('คำขอยืนยัน AraID ถูกใช้หรือหมดอายุแล้ว');
  }

  async pollAraIdChallenge(challengeToken: string) {
    this.assertEnabled();
    const challenge = await this.readActiveAraIdChallenge(challengeToken);
    if (challenge.status === 'PENDING') return { status: 'PENDING' as const };
    if (challenge.status === 'CLAIMED') {
      return {
        status: 'IN_PROGRESS' as const,
        expiresAt: new Date(challenge.expiresAt).toISOString(),
      };
    }
    const approved = await this.araIdChallengeStore.consumeApproved(ARAID_SCOPE, challengeToken);
    const result = approved ? readLineContext(approved.context) : null;
    if (!result?.bindingToken || !result.teacherName) {
      throw new GoneException('คำขอยืนยัน AraID ถูกใช้แล้ว');
    }
    return {
      status: 'APPROVED' as const,
      bindingToken: result.bindingToken,
      teacherName: result.teacherName,
    };
  }

  private async presentAraIdChallenge(
    challengeToken: string,
    challenge: Omit<StoredTeacherLineAraIdChallenge, 'token'>,
  ) {
    const verificationUrl = new URL('/line-link/araid-authorize', this.frontendBaseUrl());
    verificationUrl.hash = `challenge=${encodeURIComponent(challengeToken)}`;
    const qrDataUrl = await QRCode.toDataURL(verificationUrl.toString(), {
      width: 320,
      margin: 2,
      errorCorrectionLevel: 'M',
    });
    return {
      challengeToken,
      verificationUrl: verificationUrl.toString(),
      qrDataUrl,
      referenceCode: challenge.referenceCode,
      expiresAt: new Date(challenge.entryExpiresAt).toISOString(),
      schoolName: readLineContext(challenge.context).schoolName,
      status: challenge.status,
    };
  }

  private async readActiveAraIdChallenge(challengeToken: string) {
    const challenge = await this.araIdChallengeStore.read(ARAID_SCOPE, challengeToken);
    if (!challenge) throw new GoneException('คำขอยืนยัน AraID หมดอายุแล้ว');
    const active = await this.repository.findActiveGroupInvitationForSchool(
      readLineContext(challenge.context).schoolId,
    );
    if (
      !active ||
      active.id !== challenge.subjectId ||
      new Date(active.starts_at).getTime() > Date.now()
    ) {
      throw new GoneException('ลิงก์ยืนยัน LINE ถูกปิดหรือหมดอายุแล้ว');
    }
    return challenge;
  }

  /**
   * Step 3. Where to send the browser next. The provider only ever sees a random
   * `state`; the teacher's identity stays on our side of the redirect.
   */
  async startAuthorization(bindingToken: string): Promise<string> {
    this.assertEnabled();
    const session = await this.sessionStore.readBindingSession(bindingToken);
    if (!session) {
      throw new BadRequestException('การยืนยันหมดอายุแล้ว กรุณายืนยันอีเมลใหม่อีกครั้ง');
    }
    const nonce = randomUUID();
    const state = await this.sessionStore.createOAuthState({
      bindingToken,
      teacherId: session.teacherId,
      nonce,
    });
    return this.messaging.buildAuthorizationUrl({ state, nonce, promptAddFriend: true });
  }

  /**
   * Step 4. Turns the provider's redirect into a stored binding. Returns an
   * outcome rather than throwing, because the caller is a browser mid-redirect
   * that has to land on a page either way.
   */
  async completeAuthorization(
    code: string,
    state: string,
    ip: string | null,
  ): Promise<{ outcome: TeacherLineLinkOutcome; addContactUrl: string | null }> {
    this.assertEnabled();
    const pending = await this.sessionStore.consumeOAuthState(state);
    if (!pending || !code) {
      return { outcome: 'EXPIRED', addContactUrl: null };
    }
    // The binding session is intentionally NOT consumed yet: a teacher who has
    // not added the account needs to add it and retry without redoing identity verification.
    const session = await this.sessionStore.readBindingSession(pending.bindingToken);
    if (!session || session.teacherId !== pending.teacherId) {
      return { outcome: 'EXPIRED', addContactUrl: null };
    }
    if (session.verificationMethod !== 'GOOGLE' && session.verificationMethod !== 'ARAID') {
      await this.sessionStore.clearBindingSession(pending.bindingToken);
      return { outcome: 'EXPIRED', addContactUrl: null };
    }
    const verificationMethod = session.verificationMethod;

    let identity;
    let friendState;
    try {
      const result = await this.messaging.completeAuthorization(code, pending.nonce);
      identity = result.identity;
      friendState = result.friendState;
    } catch {
      this.logger.error('LINE link callback failed at the messaging provider');
      return { outcome: 'FAILED', addContactUrl: null };
    }

    if (friendState !== 'FRIEND') {
      // Not recorded as verified: a binding that cannot be messaged is worse
      // than none, because the teacher table would claim they are reachable.
      return { outcome: 'NOT_FRIEND', addContactUrl: this.messaging.buildAddContactUrl() };
    }

    const channelId = this.line.messagingChannelId;
    let outcome: TeacherLineLinkOutcome;
    try {
      outcome = await this.repository.withTransaction(async (queryRunner) => {
        if (
          session.schoolId &&
          !(await this.repository.hasActiveTeacherMembership(
            session.teacherId,
            queryRunner,
            session.schoolId,
          ))
        ) {
          throw new GoneException('ครูไม่ได้ปฏิบัติงานอยู่ในโรงเรียนนี้แล้ว');
        }
        let heldByOther = await this.repository.findActiveAccountByProviderUser(
          channelId,
          identity.providerUserId,
          queryRunner,
        );
        let linkOutcome: 'SUCCESS' | 'TEACHER_ALREADY_LINKED' | 'ALREADY_LINKED_TO_ANOTHER_TEACHER';
        if (heldByOther && heldByOther.teacher_id !== session.teacherId) {
          const ownerStillActive = await this.repository.hasActiveTeacherMembership(
            heldByOther.teacher_id,
            queryRunner,
          );
          if (ownerStillActive) {
            linkOutcome = 'ALREADY_LINKED_TO_ANOTHER_TEACHER';
          } else {
            await this.repository.unlinkAccount(
              heldByOther.id,
              'STALE_INACTIVE_TEACHER_BINDING',
              queryRunner,
            );
            heldByOther = null;
            linkOutcome = 'SUCCESS';
          }
        } else {
          linkOutcome = 'SUCCESS';
        }

        if (linkOutcome === 'SUCCESS') {
          const current = await this.repository.findActiveAccountForTeacher(
            session.teacherId,
            channelId,
            queryRunner,
          );
          if (current) {
            linkOutcome = 'TEACHER_ALREADY_LINKED';
          } else {
            await this.repository.insertAccount(
              {
                teacherId: session.teacherId,
                providerChannelId: channelId,
                providerUserId: identity.providerUserId,
                displayName: identity.displayName,
                friendState,
                verifiedVia: verificationMethod,
              },
              queryRunner,
            );
          }
        }

        // Binding and its audit record commit or roll back together. Otherwise an
        // audit outage could leave an unaudited recipient while the browser sees
        // a failed callback and retries the operation.
        await this.auditLog.recordAtomic(
          {
            actorUserId: null,
            actorLabel: 'line-link',
            action:
              linkOutcome === 'SUCCESS'
                ? 'TEACHER_MESSAGING_LINK'
                : 'TEACHER_MESSAGING_LINK_DENIED',
            targetType: 'teachers',
            targetId: session.teacherId,
            metadata: { provider: 'LINE', outcome: linkOutcome },
            ip,
          },
          queryRunner,
        );
        return linkOutcome;
      });
    } catch (error) {
      if (error instanceof GoneException) {
        return { outcome: 'EXPIRED', addContactUrl: null };
      }
      this.logger.error('LINE link callback transaction failed');
      return { outcome: 'FAILED', addContactUrl: null };
    }

    if (outcome === 'SUCCESS' || outcome === 'TEACHER_ALREADY_LINKED') {
      await this.sessionStore.clearBindingSession(pending.bindingToken);
    }
    return {
      outcome,
      addContactUrl:
        outcome === 'ALREADY_LINKED_TO_ANOTHER_TEACHER'
          ? this.messaging.buildAddContactUrl()
          : null,
    };
  }

  /**
   * Applies inbound follow/unfollow events. Without this the teacher table would
   * keep claiming someone is reachable long after they blocked the account —
   * the friendship reading taken at sign-in is only true for that moment.
   *
   * Returns quietly for accounts we do not know: the official account can be
   * added by anyone, most of whom are not teachers.
   */
  async applyWebhookEvents(rawBody: Buffer | string, signature: string): Promise<void> {
    if (!this.messaging.verifyWebhookSignature(rawBody, signature)) {
      throw new BadRequestException('ลายเซ็นของ webhook ไม่ถูกต้อง');
    }
    const events = parseWebhookEvents(rawBody);
    for (const event of events) {
      const friendState = event.type === 'follow' ? 'FRIEND' : 'NOT_FRIEND';
      // LINE reports "blocked us" and "deleted the account" as the same
      // unfollow event, so BLOCKED can never be told apart from NOT_FRIEND.
      const updated = await this.repository.updateFriendStateByProviderUser(
        this.line.messagingChannelId,
        event.userId,
        friendState,
      );
      if (updated > 0) {
        this.logger.log(`LINE ${event.type} applied to a linked teacher account`);
      }
    }
  }

  /**
   * Records that the provider refused a delivery to this account. Called by the
   * send path so a rejection updates the table immediately rather than waiting
   * for an unfollow webhook that may never arrive.
   */
  async markUnreachable(providerUserId: string): Promise<void> {
    await this.repository.updateFriendStateByProviderUser(
      this.line.messagingChannelId,
      providerUserId,
      'NOT_FRIEND',
    );
  }

  async unlinkActiveAccountForTeacher(
    teacherId: string,
    reason: string,
    updatedBy: number,
    queryRunner: QueryRunner,
  ): Promise<boolean> {
    return await this.repository.unlinkActiveAccountForTeacher(
      teacherId,
      reason,
      updatedBy,
      queryRunner,
    );
  }

  /** Where the browser lands after the callback, with only non-secret hints. */
  buildResultUrl(outcome: TeacherLineLinkOutcome, addContactUrl: string | null): string {
    const url = new URL('/line-link/result', this.frontendBaseUrl());
    url.searchParams.set('status', outcome.toLowerCase());
    if (addContactUrl) url.searchParams.set('addUrl', addContactUrl);
    return url.toString();
  }
}

interface WebhookFriendshipEvent {
  type: 'follow' | 'unfollow';
  userId: string;
}

/**
 * Only follow/unfollow are of interest; the account also receives messages,
 * joins and postbacks that this feature has no opinion about. A malformed body
 * yields no events rather than an error, because a webhook that keeps failing
 * gets disabled by the provider.
 */
function parseWebhookEvents(rawBody: Buffer | string): WebhookFriendshipEvent[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8'));
  } catch {
    return [];
  }
  const events = (parsed as { events?: unknown })?.events;
  if (!Array.isArray(events)) return [];
  return events.flatMap((event) => {
    const type = (event as { type?: unknown })?.type;
    const userId = (event as { source?: { userId?: unknown } })?.source?.userId;
    if ((type !== 'follow' && type !== 'unfollow') || typeof userId !== 'string' || !userId) {
      return [];
    }
    return [{ type, userId }];
  });
}
