import { SchedulerRegistry } from '@nestjs/schedule';
import { AutomationSchedulerService } from './automation-scheduler.service';

describe('AutomationSchedulerService immediate-only monitoring', () => {
  it.each([false, true])(
    'never registers a daily job (existing legacy job: %s)',
    async (exists) => {
      const registry = {
        doesExist: jest.fn().mockReturnValue(exists),
        deleteCronJob: jest.fn(),
        addCronJob: jest.fn(),
      };
      await new AutomationSchedulerService(
        registry as unknown as SchedulerRegistry,
      ).refreshDynamicCron();
      expect(registry.addCronJob).not.toHaveBeenCalled();
      expect(registry.deleteCronJob).toHaveBeenCalledTimes(exists ? 1 : 0);
    },
  );
});
