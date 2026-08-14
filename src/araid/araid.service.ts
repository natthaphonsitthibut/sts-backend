import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { PasswordService } from '../auth/password.service';
import {
  buildPaginationMeta,
  resolveLimit,
  resolvePage,
} from '../common/pagination/pagination.util';
import { AraIdIdentityRecordEntity, AraIdProfileEntity } from '../database/entities/araid.entities';
import { CreateAraIdRecordDto, ListAraIdRecordsDto, UpdateAraIdRecordDto } from './dto/araid.dto';

const PIN_ATTEMPT_LIMIT = 5;
const PIN_LOCK_MILLISECONDS = 15 * 60 * 1000;

export interface AraIdRecordResponse {
  id: string;
  identityNumber: string;
  titleTh: string | null;
  givenNameTh: string;
  familyNameTh: string;
  givenNameEn: string | null;
  familyNameEn: string | null;
  dateOfBirth: string | null;
  genderCode: string | null;
  phoneNumber: string | null;
  emailAddress: string | null;
  addressLine: string | null;
  subDistrictName: string | null;
  districtName: string | null;
  provinceName: string | null;
  postalCode: string | null;
  recordStatus: string;
  hasPin: true;
  createdAt: string;
  updatedAt: string;
}

export interface AraIdSessionProfileResponse extends Omit<AraIdRecordResponse, 'identityNumber'> {
  profileId: string;
  identityNumberMasked: string;
}

export interface AraIdRecordSummaryResponse {
  id: string;
  identityNumberMasked: string;
  titleTh: string | null;
  givenNameTh: string;
  familyNameTh: string;
  givenNameEn: string | null;
  familyNameEn: string | null;
  provinceName: string | null;
  recordStatus: 'ACTIVE' | 'INACTIVE';
  updatedAt: string;
}

@Injectable()
export class AraIdService {
  constructor(
    @InjectRepository(AraIdIdentityRecordEntity)
    private readonly records: Repository<AraIdIdentityRecordEntity>,
    @InjectRepository(AraIdProfileEntity)
    private readonly profiles: Repository<AraIdProfileEntity>,
    private readonly dataSource: DataSource,
    private readonly passwordService: PasswordService,
  ) {}

  async listRecords(query: ListAraIdRecordsDto) {
    const page = resolvePage(query.page);
    const limit = resolveLimit(query.limit);
    const builder = this.records
      .createQueryBuilder('record')
      .orderBy('record.updatedAt', 'DESC')
      .addOrderBy('record.id', 'ASC');
    if (query.recordStatus) {
      builder.andWhere('record.recordStatus = :recordStatus', {
        recordStatus: query.recordStatus,
      });
    }
    if (query.search) {
      const identitySearch = query.search.replace(/\D/g, '');
      builder.andWhere(
        `(
          ${identitySearch ? 'record.identityNumber LIKE :identitySearch OR' : ''}
          LOWER(record.givenNameTh) LIKE LOWER(:search)
          OR LOWER(record.familyNameTh) LIKE LOWER(:search)
          OR LOWER(COALESCE(record.givenNameEn, '')) LIKE LOWER(:search)
          OR LOWER(COALESCE(record.familyNameEn, '')) LIKE LOWER(:search)
          OR LOWER(COALESCE(record.provinceName, '')) LIKE LOWER(:search)
        )`,
        {
          ...(identitySearch ? { identitySearch: `%${identitySearch}%` } : {}),
          search: `%${query.search}%`,
        },
      );
    }
    const [[records, totalCount], activeCount, allCount] = await Promise.all([
      builder
        .skip((page - 1) * limit)
        .take(limit)
        .getManyAndCount(),
      this.records.count({ where: { recordStatus: 'ACTIVE' } }),
      this.records.count(),
    ]);
    return {
      records: records.map((record) => this.toRecordSummaryResponse(record)),
      meta: buildPaginationMeta(page, limit, totalCount),
      counts: {
        total: allCount,
        active: activeCount,
      },
    };
  }

  async getRecord(recordId: string): Promise<AraIdRecordResponse> {
    return this.toRecordResponse(await this.findRecordOrThrow(recordId));
  }

  async createRecord(
    actorUserId: number,
    input: CreateAraIdRecordDto,
  ): Promise<AraIdRecordResponse> {
    const existing = await this.records.findOne({
      where: { identityNumber: input.identityNumber },
    });
    if (existing) throw new ConflictException('เลขประจำตัวนี้มีอยู่แล้ว');
    const pinHash = await this.passwordService.hash(input.pin);

    try {
      return await this.dataSource.transaction(async (manager) => {
        const recordRepository = manager.getRepository(AraIdIdentityRecordEntity);
        const profileRepository = manager.getRepository(AraIdProfileEntity);
        const record = recordRepository.create({
          ...this.recordFields(input),
          identityNumber: input.identityNumber,
          recordStatus: 'ACTIVE',
          createdByUserId: actorUserId,
          updatedByUserId: actorUserId,
        });
        const savedRecord = await recordRepository.save(record);
        await profileRepository.save(
          profileRepository.create({
            identityRecordId: savedRecord.id,
            createdByUserId: actorUserId,
            pinHash,
            registrationStatus: 'ACTIVE',
            registrationMethod: 'MANAGED',
            failedPinAttempts: 0,
            pinLockedUntil: null,
          }),
        );
        return this.toRecordResponse(savedRecord);
      });
    } catch (error) {
      if (this.databaseErrorCode(error) === '23505') {
        throw new ConflictException('เลขประจำตัวนี้มีอยู่แล้ว');
      }
      throw error;
    }
  }

  async updateRecord(
    actorUserId: number,
    recordId: string,
    input: UpdateAraIdRecordDto,
  ): Promise<AraIdRecordResponse> {
    const record = await this.findRecordOrThrow(recordId);
    const pinHash = input.pin ? await this.passwordService.hash(input.pin) : null;

    try {
      return await this.dataSource.transaction(async (manager) => {
        const recordRepository = manager.getRepository(AraIdIdentityRecordEntity);
        const profileRepository = manager.getRepository(AraIdProfileEntity);
        Object.assign(record, this.recordFields(input));
        if (input.identityNumber) record.identityNumber = input.identityNumber;
        record.updatedByUserId = actorUserId;
        const savedRecord = await recordRepository.save(record);
        if (pinHash) {
          const profile = await profileRepository.findOne({
            where: { identityRecordId: record.id },
          });
          if (!profile) throw new NotFoundException('ไม่พบข้อมูลการเข้าใช้งาน AraID');
          profile.pinHash = pinHash;
          profile.failedPinAttempts = 0;
          profile.pinLockedUntil = null;
          profile.registrationStatus = 'ACTIVE';
          await profileRepository.save(profile);
        }
        return this.toRecordResponse(savedRecord);
      });
    } catch (error) {
      if (this.databaseErrorCode(error) === '23505') {
        throw new ConflictException('เลขประจำตัวนี้มีอยู่แล้ว');
      }
      throw error;
    }
  }

  async updateRecordStatus(
    actorUserId: number,
    recordId: string,
    recordStatus: 'ACTIVE' | 'INACTIVE',
  ): Promise<AraIdRecordResponse> {
    return this.dataSource.transaction(async (manager) => {
      const recordRepository = manager.getRepository(AraIdIdentityRecordEntity);
      const profileRepository = manager.getRepository(AraIdProfileEntity);
      const record = await recordRepository.findOne({ where: { id: recordId } });
      if (!record) throw new NotFoundException('ไม่พบข้อมูล AraID');
      const profile = await profileRepository.findOne({
        where: { identityRecordId: record.id },
      });
      if (!profile) throw new NotFoundException('ไม่พบข้อมูลการเข้าใช้งาน AraID');

      record.recordStatus = recordStatus;
      record.updatedByUserId = actorUserId;
      profile.registrationStatus = recordStatus === 'ACTIVE' ? 'ACTIVE' : 'REVOKED';
      profile.failedPinAttempts = 0;
      profile.pinLockedUntil = null;
      await profileRepository.save(profile);
      return this.toRecordResponse(await recordRepository.save(record));
    });
  }

  async login(identityNumber: string, pin: string): Promise<AraIdSessionProfileResponse> {
    const record = await this.records.findOne({
      where: { identityNumber, recordStatus: 'ACTIVE' },
    });
    if (!record) throw new UnauthorizedException('เลขประจำตัวหรือ PIN ไม่ถูกต้อง');
    const profile = await this.profiles.findOne({ where: { identityRecordId: record.id } });
    if (!profile || profile.registrationStatus === 'REVOKED') {
      throw new UnauthorizedException('เลขประจำตัวหรือ PIN ไม่ถูกต้อง');
    }

    const now = new Date();
    if (profile.pinLockedUntil && profile.pinLockedUntil > now) {
      throw new HttpException(
        'บัญชีถูกล็อกชั่วคราว กรุณาลองใหม่ภายหลัง',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (profile.pinLockedUntil) {
      profile.pinLockedUntil = null;
      profile.failedPinAttempts = 0;
      profile.registrationStatus = 'ACTIVE';
    }

    if (!(await this.passwordService.compare(pin, profile.pinHash))) {
      profile.failedPinAttempts += 1;
      if (profile.failedPinAttempts >= PIN_ATTEMPT_LIMIT) {
        profile.failedPinAttempts = PIN_ATTEMPT_LIMIT;
        profile.registrationStatus = 'LOCKED';
        profile.pinLockedUntil = new Date(now.getTime() + PIN_LOCK_MILLISECONDS);
      }
      await this.profiles.save(profile);
      throw new UnauthorizedException('เลขประจำตัวหรือ PIN ไม่ถูกต้อง');
    }

    profile.failedPinAttempts = 0;
    profile.pinLockedUntil = null;
    profile.registrationStatus = 'ACTIVE';
    await this.profiles.save(profile);
    return this.toSessionResponse(profile, record);
  }

  async getSessionProfile(profileId: string): Promise<AraIdSessionProfileResponse> {
    const profile = await this.profiles.findOne({ where: { id: profileId } });
    if (!profile || profile.registrationStatus !== 'ACTIVE') {
      throw new UnauthorizedException('เซสชัน AraID ไม่ถูกต้อง');
    }
    const record = await this.records.findOne({
      where: { id: profile.identityRecordId, recordStatus: 'ACTIVE' },
    });
    if (!record) throw new UnauthorizedException('เซสชัน AraID ไม่ถูกต้อง');
    return this.toSessionResponse(profile, record);
  }

  async reauthenticate(profileId: string, pin: string): Promise<void> {
    const profile = await this.profiles.findOne({ where: { id: profileId } });
    if (!profile || profile.registrationStatus === 'REVOKED') {
      throw new UnauthorizedException('เซสชัน AraID ไม่ถูกต้อง');
    }
    const record = await this.records.findOne({
      where: { id: profile.identityRecordId, recordStatus: 'ACTIVE' },
    });
    if (!record) throw new UnauthorizedException('เซสชัน AraID ไม่ถูกต้อง');

    const now = new Date();
    if (profile.pinLockedUntil && profile.pinLockedUntil > now) {
      throw new HttpException(
        'บัญชีถูกล็อกชั่วคราว กรุณาลองใหม่ภายหลัง',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (profile.pinLockedUntil) {
      profile.pinLockedUntil = null;
      profile.failedPinAttempts = 0;
      profile.registrationStatus = 'ACTIVE';
    }
    if (!(await this.passwordService.compare(pin, profile.pinHash))) {
      profile.failedPinAttempts += 1;
      if (profile.failedPinAttempts >= PIN_ATTEMPT_LIMIT) {
        profile.failedPinAttempts = PIN_ATTEMPT_LIMIT;
        profile.registrationStatus = 'LOCKED';
        profile.pinLockedUntil = new Date(now.getTime() + PIN_LOCK_MILLISECONDS);
      }
      await this.profiles.save(profile);
      throw new UnauthorizedException('PIN ไม่ถูกต้อง');
    }
    profile.failedPinAttempts = 0;
    profile.pinLockedUntil = null;
    profile.registrationStatus = 'ACTIVE';
    await this.profiles.save(profile);
  }

  /** Server-only identity claim for relying flows; never expose this value to the browser. */
  async getVerifiedIdentityNumber(profileId: string): Promise<string> {
    const profile = await this.profiles.findOne({ where: { id: profileId } });
    if (!profile || profile.registrationStatus !== 'ACTIVE') {
      throw new UnauthorizedException('เซสชัน AraID ไม่ถูกต้อง');
    }
    const record = await this.records.findOne({
      where: { id: profile.identityRecordId, recordStatus: 'ACTIVE' },
    });
    if (!record) throw new UnauthorizedException('เซสชัน AraID ไม่ถูกต้อง');
    return record.identityNumber;
  }

  private async findRecordOrThrow(id: string): Promise<AraIdIdentityRecordEntity> {
    const record = await this.records.findOne({ where: { id } });
    if (!record) throw new NotFoundException('ไม่พบข้อมูล AraID');
    return record;
  }

  private recordFields(input: UpdateAraIdRecordDto): Partial<AraIdIdentityRecordEntity> {
    const fields: Partial<AraIdIdentityRecordEntity> = {};
    if (input.titleTh !== undefined) fields.titleTh = input.titleTh.trim() || null;
    if (input.givenNameTh !== undefined) fields.givenNameTh = input.givenNameTh.trim();
    if (input.familyNameTh !== undefined) fields.familyNameTh = input.familyNameTh.trim();
    if (input.givenNameEn !== undefined) fields.givenNameEn = input.givenNameEn?.trim() || null;
    if (input.familyNameEn !== undefined) {
      fields.familyNameEn = input.familyNameEn?.trim() || null;
    }
    if (input.dateOfBirth !== undefined) fields.dateOfBirth = input.dateOfBirth || null;
    if (input.genderCode !== undefined) fields.genderCode = input.genderCode ?? null;
    if (input.phoneNumber !== undefined) fields.phoneNumber = input.phoneNumber?.trim() || null;
    if (input.emailAddress !== undefined) fields.emailAddress = input.emailAddress?.trim() || null;
    if (input.addressLine !== undefined) fields.addressLine = input.addressLine?.trim() || null;
    if (input.subDistrictName !== undefined) {
      fields.subDistrictName = input.subDistrictName?.trim() || null;
    }
    if (input.districtName !== undefined) {
      fields.districtName = input.districtName?.trim() || null;
    }
    if (input.provinceName !== undefined) {
      fields.provinceName = input.provinceName?.trim() || null;
    }
    if (input.postalCode !== undefined) fields.postalCode = input.postalCode || null;
    return fields;
  }

  private toRecordResponse(record: AraIdIdentityRecordEntity): AraIdRecordResponse {
    return {
      id: record.id,
      identityNumber: record.identityNumber,
      titleTh: record.titleTh,
      givenNameTh: record.givenNameTh,
      familyNameTh: record.familyNameTh,
      givenNameEn: record.givenNameEn,
      familyNameEn: record.familyNameEn,
      dateOfBirth: record.dateOfBirth,
      genderCode: record.genderCode,
      phoneNumber: record.phoneNumber,
      emailAddress: record.emailAddress,
      addressLine: record.addressLine,
      subDistrictName: record.subDistrictName,
      districtName: record.districtName,
      provinceName: record.provinceName,
      postalCode: record.postalCode,
      recordStatus: record.recordStatus,
      hasPin: true,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private toRecordSummaryResponse(record: AraIdIdentityRecordEntity): AraIdRecordSummaryResponse {
    return {
      id: record.id,
      identityNumberMasked: this.maskIdentityNumber(record.identityNumber),
      titleTh: record.titleTh,
      givenNameTh: record.givenNameTh,
      familyNameTh: record.familyNameTh,
      givenNameEn: record.givenNameEn,
      familyNameEn: record.familyNameEn,
      provinceName: record.provinceName,
      recordStatus: record.recordStatus,
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private toSessionResponse(
    profile: AraIdProfileEntity,
    record: AraIdIdentityRecordEntity,
  ): AraIdSessionProfileResponse {
    const safeRecord = this.toRecordResponse(record);
    return {
      profileId: profile.id,
      identityNumberMasked: this.maskIdentityNumber(record.identityNumber),
      id: safeRecord.id,
      titleTh: safeRecord.titleTh,
      givenNameTh: safeRecord.givenNameTh,
      familyNameTh: safeRecord.familyNameTh,
      givenNameEn: safeRecord.givenNameEn,
      familyNameEn: safeRecord.familyNameEn,
      dateOfBirth: safeRecord.dateOfBirth,
      genderCode: safeRecord.genderCode,
      phoneNumber: safeRecord.phoneNumber,
      emailAddress: safeRecord.emailAddress,
      addressLine: safeRecord.addressLine,
      subDistrictName: safeRecord.subDistrictName,
      districtName: safeRecord.districtName,
      provinceName: safeRecord.provinceName,
      postalCode: safeRecord.postalCode,
      recordStatus: safeRecord.recordStatus,
      hasPin: safeRecord.hasPin,
      createdAt: safeRecord.createdAt,
      updatedAt: safeRecord.updatedAt,
    };
  }

  private maskIdentityNumber(identityNumber: string): string {
    return `x-xxxx-xxxxx-${identityNumber.slice(-2)}-x`;
  }

  private databaseErrorCode(error: unknown): string | null {
    return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
      ? error.code
      : null;
  }
}
