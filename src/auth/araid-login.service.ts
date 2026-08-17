import {
  ForbiddenException,
  GoneException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as QRCode from 'qrcode';
import { AraIdChallengeStore, type AraIdChallengeScope } from '../araid/araid-challenge.store';
import { AraIdService } from '../araid/araid.service';

const ARAID_SCOPE: AraIdChallengeScope = 'admin-login';

interface LoginUserRow extends Record<string, unknown> {
  id: number | string;
}

/**
 * Turns a fresh AraID approval into a normal STS staff session. Only an account
 * in an assignable menu group can be resolved and no AraID identity details
 * leave the server, which keeps the login flow fail-closed and non-enumerable.
 */
@Injectable()
export class AraIdLoginService {
  constructor(
    private readonly araIdChallengeStore: AraIdChallengeStore,
    private readonly araIdService: AraIdService,
    private readonly dataSource: DataSource,
  ) {}

  async createChallenge(baseUrl: string) {
    const challenge = await this.araIdChallengeStore.create(ARAID_SCOPE, ARAID_SCOPE);
    const verificationUrl = new URL('/araid/authorize', baseUrl);
    verificationUrl.hash = `challenge=${encodeURIComponent(challenge.token)}&scope=${ARAID_SCOPE}`;
    const qrDataUrl = await QRCode.toDataURL(verificationUrl.toString(), {
      width: 320,
      margin: 2,
      errorCorrectionLevel: 'M',
    });
    return {
      challengeToken: challenge.token,
      verificationUrl: verificationUrl.toString(),
      qrDataUrl,
      referenceCode: challenge.referenceCode,
      expiresAt: new Date(challenge.entryExpiresAt).toISOString(),
    };
  }

  async beginChallenge(challengeToken: string, existingAuthorizationToken?: string) {
    if (existingAuthorizationToken) {
      const resumed = await this.araIdChallengeStore.resume(
        ARAID_SCOPE,
        challengeToken,
        existingAuthorizationToken,
      );
      if (resumed) return resumed;
    }
    const challenge = await this.araIdChallengeStore.read(ARAID_SCOPE, challengeToken);
    if (!challenge) throw new GoneException('คำขอเข้าสู่ระบบ AraID หมดอายุแล้ว');
    const authorization = await this.araIdChallengeStore.claim(ARAID_SCOPE, challengeToken);
    if (!authorization) throw new GoneException('คำขอเข้าสู่ระบบ AraID ถูกเปิดใช้หรือหมดอายุแล้ว');
    return authorization;
  }

  async approveChallenge(
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
      throw new UnauthorizedException('กรุณากรอก PIN AraID ใหม่เพื่อเข้าสู่ระบบ');
    }

    const identityNumber = await this.araIdService.getVerifiedIdentityNumber(araIdProfileId);
    const userId = await this.findEligibleUserId(identityNumber);
    if (
      !(await this.araIdChallengeStore.approveAuthorization(ARAID_SCOPE, authorizationToken, {
        userId,
      }))
    ) {
      throw new GoneException('คำขอเข้าสู่ระบบ AraID ถูกใช้หรือหมดอายุแล้ว');
    }
    return { approved: true };
  }

  async pollChallenge(challengeToken: string) {
    const challenge = await this.araIdChallengeStore.read(ARAID_SCOPE, challengeToken);
    if (!challenge) throw new GoneException('คำขอเข้าสู่ระบบ AraID หมดอายุแล้ว');
    if (challenge.status === 'PENDING') return { status: 'PENDING' as const };
    if (challenge.status === 'CLAIMED') {
      return {
        status: 'IN_PROGRESS' as const,
        expiresAt: new Date(challenge.expiresAt).toISOString(),
      };
    }

    const consumed = await this.araIdChallengeStore.consumeApproved(ARAID_SCOPE, challengeToken);
    if (!consumed) throw new GoneException('คำขอเข้าสู่ระบบ AraID ถูกใช้แล้ว');
    const rawUserId = consumed.context.userId;
    const userId = typeof rawUserId === 'number' ? rawUserId : Number(rawUserId);
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      throw new ForbiddenException('ไม่สามารถเข้าสู่ระบบด้วย AraID ได้');
    }
    return { status: 'APPROVED' as const, userId };
  }

  private async findEligibleUserId(identityNumber: string): Promise<number> {
    const normalizedIdentityNumber = identityNumber.replace(/\D/g, '');
    if (!/^\d{13}$/.test(normalizedIdentityNumber)) {
      throw new ForbiddenException('ไม่สามารถเข้าสู่ระบบด้วย AraID ได้');
    }
    // Which groups may sign in is a property of the menu group, not a list kept
    // here: a school's own group (`S1001_BASE_ADMIN`) is as real a login as the
    // global one, and a group added later must not need a code change to work.
    const rows = await this.dataSource.query<LoginUserRow[]>(
      `
        SELECT account.id
        FROM users account
        JOIN roles role_group ON role_group.name = account.role
        WHERE account.status = 'ACTIVE'
          AND role_group.is_assignable IS TRUE
          AND REGEXP_REPLACE(COALESCE(account."PersonID_Onec", ''), '[^0-9]', '', 'g') = $1
          AND (
            account.must_change_password IS NOT TRUE
            OR account.temporary_password_expires_at IS NULL
            OR account.temporary_password_expires_at > NOW()
          )
        ORDER BY account.id ASC
        LIMIT 2
      `,
      [normalizedIdentityNumber],
    );
    if (rows.length !== 1) {
      throw new ForbiddenException('ไม่สามารถเข้าสู่ระบบด้วย AraID ได้');
    }
    const userId = Number(rows[0].id);
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      throw new ForbiddenException('ไม่สามารถเข้าสู่ระบบด้วย AraID ได้');
    }
    return userId;
  }
}
