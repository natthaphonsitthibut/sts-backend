import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AuthActorService } from '../auth/auth-actor.service';
import type { RequestWithUser } from '../auth/auth.types';
import { StatsController } from './stats.controller';
import { TaskService } from './task.service';

describe('StatsController report filter contract', () => {
  let app: INestApplication<App>;
  const actor = {
    id: 7,
    username: 'report-reader',
    roles: ['EXECUTIVE'],
    permissions: ['dashboard'],
    data_scope: { provinces: ['ขอนแก่น'] },
  };
  const response = {
    success: true,
    data: {
      grades: [{ value: 'ม.1', label: 'ม.1' }],
      rooms: ['1'],
      terms: [{ academicYear: 2569, semester: 1 }],
    },
  };
  const service = {
    getRiskDashboardFilterOptions: jest.fn().mockResolvedValue(response),
    getFollowUpSummary: jest.fn().mockResolvedValue({ success: true, data: {} }),
    getReferralDrilldown: jest.fn().mockResolvedValue({ success: true, data: [] }),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [StatsController],
      providers: [
        { provide: TaskService, useValue: service },
        {
          provide: AuthActorService,
          useValue: {
            loadRequiredUser: jest.fn((req: RequestWithUser) => {
              const fixture = req.headers['x-test-actor'];
              if (!fixture) return null;
              return fixture === 'allowed' ? actor : { ...actor, permissions: [] };
            }),
          },
        },
      ],
    }).compile();
    app = module.createNestApplication<App>();
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
  });
  afterAll(async () => {
    if (app) await app.close();
  });
  beforeEach(() => jest.clearAllMocks());

  it('requires authentication and dashboard permission', async () => {
    const endpoint = '/api/dashboard/risk-watchlist/filter-options';
    await request(app.getHttpServer()).get(endpoint).expect(401);
    await request(app.getHttpServer()).get(endpoint).set('x-test-actor', 'denied').expect(403);
    expect(service.getRiskDashboardFilterOptions).not.toHaveBeenCalled();
  });

  it('returns dynamic choices and binds the authenticated actor with validated geographic filters', async () => {
    await request(app.getHttpServer())
      .get('/api/dashboard/risk-watchlist/filter-options')
      .set('x-test-actor', 'allowed')
      .query({
        province: ' ขอนแก่น ',
        district: 'เมืองขอนแก่น',
        subDistrict: 'ในเมือง',
        schoolId: '101',
        grade: 'ม.1',
        academicYear: '2569',
        semester: '3',
      })
      .expect(200)
      .expect(response);
    expect(service.getRiskDashboardFilterOptions).toHaveBeenCalledWith(actor, {
      province: 'ขอนแก่น',
      district: 'เมืองขอนแก่น',
      subDistrict: 'ในเมือง',
      schoolId: 101,
      grade: 'ม.1',
      academicYear: 2569,
      semester: 3,
    });
  });

  it.each(['schoolId', 'academicYear', 'semester'])(
    'rejects invalid positive integer %s before querying choices',
    async (field) => {
      for (const value of ['invalid', '0', '-1', '1.5']) {
        await request(app.getHttpServer())
          .get('/api/dashboard/risk-watchlist/filter-options')
          .set('x-test-actor', 'allowed')
          .query({ [field]: value })
          .expect(400);
      }
      expect(service.getRiskDashboardFilterOptions).not.toHaveBeenCalled();
    },
  );

  it.each(['/api/dashboard/follow-up-summary', '/api/dashboard/referrals'])(
    '%s accepts explicit terms and leaves unselected terms unrestricted',
    async (endpoint) => {
      const method = endpoint.endsWith('referrals')
        ? service.getReferralDrilldown
        : service.getFollowUpSummary;
      await request(app.getHttpServer())
        .get(endpoint)
        .set('x-test-actor', 'allowed')
        .query({ academicYear: '2569', semester: '3', grade: 'ม.1', room: '2' })
        .expect(200);
      const [, selectedFilters] = method.mock.calls[0] as unknown[];
      expect(selectedFilters).toEqual(
        expect.objectContaining({ academicYear: 2569, semester: 3, grade: 'ม.1', room: '2' }),
      );
      await request(app.getHttpServer()).get(endpoint).set('x-test-actor', 'allowed').expect(200);
      const [, allTermFilters] = method.mock.calls[1] as unknown[];
      expect(allTermFilters).toEqual(
        expect.objectContaining({ academicYear: undefined, semester: undefined }),
      );
      await request(app.getHttpServer())
        .get(endpoint)
        .set('x-test-actor', 'allowed')
        .query({ semester: '0' })
        .expect(400);
    },
  );
});
