import { BadRequestException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import request from 'supertest';
import type { App } from 'supertest/types';
import { FILE_STORAGE_ADAPTER, type FileStorageAdapter } from '../files/storage/file-storage.types';
import { SubmissionController } from './submission.controller';
import { TaskService } from './task.service';

describe('SubmissionController multipart report', () => {
  const access = jest.fn().mockResolvedValue(undefined);
  const save = jest.fn().mockResolvedValue({ id: 1 });
  const controller = new SubmissionController(
    {
      assertVisitSubmissionAccess: access,
      saveTaskSubmission: save,
    } as unknown as TaskService,
    {} as FileStorageAdapter,
  );
  const request = { headers: {} } as Request;

  beforeEach(() => jest.clearAllMocks());

  it('rejects a stale singular guardian field instead of losing the answer', async () => {
    await expect(
      controller.submitReport(
        'link-placeholder',
        { task_execution_outcome_code: 'SUCCEEDED', guardian_type_code: 'MOTHER' },
        [],
        request,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(save).not.toHaveBeenCalled();
  });

  it('passes the OTHER channel detail through the multipart contract', async () => {
    await controller.submitReport(
      'link-placeholder',
      {
        task_execution_outcome_code: 'SUCCEEDED',
        contact_channel_code: 'OTHER',
        contact_channel_detail: 'อีเมล',
      },
      [],
      request,
    );
    expect(save).toHaveBeenCalledWith(
      'link-placeholder',
      expect.objectContaining({
        contact_channel_code: 'OTHER',
        contact_channel_detail: 'อีเมล',
      }),
      undefined,
    );
  });

  it('accepts JSON arrays without using one multipart field per selected option', async () => {
    await controller.submitReport(
      'link-placeholder',
      {
        task_execution_outcome_code: 'SUCCEEDED',
        disadvantage_type_codes: '["POVERTY","ORPHAN"]',
        disability_type_codes: '[]',
        residence_environment_codes: '["CROWDED","REMOTE"]',
        guardian_type_codes: '["FATHER","MOTHER"]',
      },
      [],
      request,
    );

    expect(save).toHaveBeenCalledWith(
      'link-placeholder',
      expect.objectContaining({
        disadvantage_type_codes: ['POVERTY', 'ORPHAN'],
        disability_type_codes: [],
        residence_environment_codes: ['CROWDED', 'REMOTE'],
        guardian_type_codes: ['FATHER', 'MOTHER'],
      }),
      undefined,
    );
  });

  it('continues to accept repeated fields from existing clients', async () => {
    await controller.submitReport(
      'link-placeholder',
      {
        task_execution_outcome_code: 'SUCCEEDED',
        disadvantage_type_codes: ['POVERTY', 'ORPHAN'],
      } as unknown as Record<string, string>,
      [],
      request,
    );

    expect(save).toHaveBeenCalledWith(
      'link-placeholder',
      expect.objectContaining({ disadvantage_type_codes: ['POVERTY', 'ORPHAN'] }),
      undefined,
    );
  });

  it('rejects malformed option arrays before saving', async () => {
    await expect(
      controller.submitReport(
        'link-placeholder',
        { task_execution_outcome_code: 'SUCCEEDED', disadvantage_type_codes: '["POVERTY",42]' },
        [],
        request,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(save).not.toHaveBeenCalled();
  });
});

describe('SubmissionController attachment limits', () => {
  let app: INestApplication<App>;
  const save = jest.fn().mockResolvedValue({ id: 1 });
  const storage = { save: jest.fn().mockResolvedValue(undefined) };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [SubmissionController],
      providers: [
        {
          provide: TaskService,
          useValue: {
            assertVisitSubmissionAccess: jest.fn().mockResolvedValue(undefined),
            saveTaskSubmission: save,
          },
        },
        { provide: FILE_STORAGE_ADAPTER, useValue: storage },
      ],
    }).compile();
    app = module.createNestApplication<App>();
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
  });
  beforeEach(() => jest.clearAllMocks());

  it('rejects the old guardian contract before storing attachments', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/tasks/link-placeholder/submit')
      .field('task_execution_outcome_code', 'SUCCEEDED')
      .field('guardian_type_code', 'FATHER_AND_MOTHER')
      .attach('photos', Buffer.from('%PDF-test'), {
        filename: 'proof.pdf',
        contentType: 'application/pdf',
      });
    expect(response.status).toBe(400);
    expect(storage.save).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('accepts ten small attachments in a real multipart request', async () => {
    let upload = request(app.getHttpServer())
      .post('/api/tasks/link-placeholder/submit')
      .field('task_execution_outcome_code', 'SUCCEEDED')
      .field('guardian_type_codes', '["FATHER","MOTHER"]');
    for (let index = 0; index < 10; index += 1) {
      upload = upload.attach('photos', Buffer.from('%PDF-test'), {
        filename: `proof-${index}.pdf`,
        contentType: 'application/pdf',
      });
    }

    await upload.expect(201);
    expect(storage.save).toHaveBeenCalledTimes(10);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(
      'link-placeholder',
      expect.objectContaining({ guardian_type_codes: ['FATHER', 'MOTHER'] }),
      undefined,
    );
  });

  it('rejects the eleventh attachment before saving', async () => {
    let upload = request(app.getHttpServer())
      .post('/api/tasks/link-placeholder/submit')
      .field('task_execution_outcome_code', 'SUCCEEDED');
    for (let index = 0; index < 11; index += 1) {
      upload = upload.attach('photos', Buffer.from('%PDF-test'), {
        filename: `proof-${index}.pdf`,
        contentType: 'application/pdf',
      });
    }

    const response = await upload.expect(400);
    expect(response.body as unknown).toMatchObject({ message: 'Too many files' });
    expect(storage.save).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('rejects an attachment over 5 MB before saving', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/tasks/link-placeholder/submit')
      .field('task_execution_outcome_code', 'SUCCEEDED')
      .attach('photos', Buffer.alloc(5 * 1024 * 1024 + 1), {
        filename: 'oversized.pdf',
        contentType: 'application/pdf',
      })
      .expect(413);
    expect(response.body as unknown).toMatchObject({ message: 'File too large' });

    expect(storage.save).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});
