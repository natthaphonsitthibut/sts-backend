import type { Repository } from 'typeorm';
import { NlQueryLog } from './entities/nl-query-log.entity';
import { NlQueryLogService } from './nl-query-log.service';

describe('NlQueryLogService', () => {
  let repository: jest.Mocked<Pick<Repository<NlQueryLog>, 'create' | 'save' | 'update'>>;
  let service: NlQueryLogService;

  beforeEach(() => {
    repository = {
      create: jest.fn((value) => value as NlQueryLog),
      save: jest.fn().mockResolvedValue({ id: '41' }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    service = new NlQueryLogService(repository as unknown as Repository<NlQueryLog>);
  });

  it('creates a pending audit anchor before a query', async () => {
    await expect(
      service.begin({
        userId: 7,
        dataScope: { school_ids: [1001] },
        question: 'นักเรียนทั้งหมดกี่คน',
      }),
    ).resolves.toBe('41');

    expect(repository.create).toHaveBeenCalledWith({
      userId: 7,
      dataScope: { school_ids: [1001] },
      question: 'นักเรียนทั้งหมดกี่คน',
      status: 'pending',
    });
  });

  it('completes an audit row with the upstream outcome', async () => {
    await service.complete('41', {
      requestId: 'request-1',
      sql: 'SELECT 1',
      status: 'ok',
      errorCode: null,
      rowCount: 1,
      retryCount: 0,
      elapsedMs: 50,
    });

    expect(repository.update).toHaveBeenCalledWith(
      '41',
      expect.objectContaining({
        requestId: 'request-1',
        status: 'ok',
        completedAt: expect.any(Date) as Date,
      }),
    );
  });

  it('marks transport failures separately from business errors', async () => {
    await service.fail('41', 'Error: upstream 503');

    expect(repository.update).toHaveBeenCalledWith('41', {
      status: 'failed',
      errorDetail: 'Error: upstream 503',
      completedAt: expect.any(Date) as Date,
    });
  });
});
