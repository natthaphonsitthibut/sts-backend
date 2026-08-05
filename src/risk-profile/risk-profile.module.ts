import { Module } from '@nestjs/common';
import { RiskProfileRepository } from './risk-profile.repository';
import { RiskProfileService } from './risk-profile.service';

@Module({
  providers: [RiskProfileRepository, RiskProfileService],
  exports: [RiskProfileService],
})
export class RiskProfileModule {}
