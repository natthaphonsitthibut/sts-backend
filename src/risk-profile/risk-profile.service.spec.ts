import { RiskProfileRepository } from './risk-profile.repository';
import { RiskProfileService } from './risk-profile.service';

describe('RiskProfileService', () => {
  let repository: jest.Mocked<
    Pick<
      RiskProfileRepository,
      'getRiskThresholds' | 'recalculateAll' | 'recalculateStudents' | 'countMissingActiveProfiles'
    >
  >;
  let service: RiskProfileService;
  let queue: {
    add: jest.MockedFunction<(name: string, data: unknown, options: unknown) => Promise<void>>;
  };

  beforeEach(() => {
    repository = {
      getRiskThresholds: jest.fn().mockResolvedValue({
        lowConsecutiveAbsentDays: 3,
        mediumConsecutiveAbsentDays: 5,
        highConsecutiveAbsentDays: 7,
        highAttendancePercent: 80,
        subjectLateWindowDays: 10,
        subjectLateWatchCount: 4,
      }),
      recalculateAll: jest.fn().mockResolvedValue(10),
      recalculateStudents: jest.fn().mockResolvedValue(1),
      countMissingActiveProfiles: jest.fn().mockResolvedValue(0),
    };
    service = new RiskProfileService(repository as unknown as RiskProfileRepository);
    queue = {
      add: jest.fn<Promise<void>, [string, unknown, unknown]>().mockResolvedValue(undefined),
    };
    (service as unknown as { queue: typeof queue }).queue = queue;
  });

  it('dispatches student recalculation through BullMQ only', async () => {
    await service.enqueueStudents([' student-1 ', 'student-1', 'student-2'], 'attendance-save');

    expect(queue.add).toHaveBeenCalledWith(
      'students',
      {
        kind: 'students',
        studentUuids: ['student-1', 'student-2'],
        reason: 'attendance-save',
      },
      expect.any(Object),
    );
    const studentsOptions = queue.add.mock.calls[0]?.[2] as { jobId?: string };
    expect(studentsOptions.jobId).toMatch(/^risk-profile:students:/);
    expect(repository.recalculateStudents).not.toHaveBeenCalled();
  });

  it('dispatches full recalculation through BullMQ only', async () => {
    await service.enqueueFull('settings-change');

    expect(queue.add).toHaveBeenCalledWith(
      'full',
      { kind: 'full', reason: 'settings-change' },
      expect.any(Object),
    );
    const fullOptions = queue.add.mock.calls[0]?.[2] as { jobId?: string };
    expect(fullOptions.jobId).toMatch(/^risk-profile:full:/);
    expect(repository.recalculateAll).not.toHaveBeenCalled();
  });

  it('fails closed when the queue is not ready', async () => {
    (service as unknown as { queue?: typeof queue }).queue = undefined;

    await expect(service.enqueueFull('settings-change')).rejects.toThrow(
      'Risk profile queue is not ready',
    );

    expect(repository.recalculateAll).not.toHaveBeenCalled();
  });
});
