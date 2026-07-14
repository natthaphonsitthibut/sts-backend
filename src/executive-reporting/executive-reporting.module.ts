import { DynamicModule, Module } from '@nestjs/common';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { AuthModule } from '../auth';
import { executiveReportingConfig } from '../config/executive-reporting.config';
import { ExecutiveReportingController } from './executive-reporting.controller';
import {
  EXECUTIVE_REPORTING_POLICY,
  resolveExecutiveReportingPolicy,
} from './executive-reporting.policy';
import { ExecutiveReportingRepository } from './executive-reporting.repository';
import { ExecutiveReportingService } from './executive-reporting.service';
import type { ResolveExecutiveReportingPolicyInput } from './executive-reporting.types';

@Module({})
export class ExecutiveReportingModule {
  static register(policyInput: ResolveExecutiveReportingPolicyInput): DynamicModule {
    const policy = resolveExecutiveReportingPolicy(policyInput);
    return {
      module: ExecutiveReportingModule,
      imports: [AuthModule],
      controllers: [ExecutiveReportingController],
      providers: [
        ExecutiveReportingRepository,
        ExecutiveReportingService,
        { provide: EXECUTIVE_REPORTING_POLICY, useValue: policy },
      ],
      exports: [ExecutiveReportingService],
    };
  }

  static registerAsync(): DynamicModule {
    return {
      module: ExecutiveReportingModule,
      imports: [AuthModule, ConfigModule.forFeature(executiveReportingConfig)],
      controllers: [ExecutiveReportingController],
      providers: [
        ExecutiveReportingRepository,
        ExecutiveReportingService,
        {
          provide: EXECUTIVE_REPORTING_POLICY,
          inject: [executiveReportingConfig.KEY],
          useFactory: (config: ConfigType<typeof executiveReportingConfig>) =>
            resolveExecutiveReportingPolicy(config),
        },
      ],
      exports: [ExecutiveReportingService],
    };
  }
}
