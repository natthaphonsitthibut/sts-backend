import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth';
import { CaseTrackingOptionsService } from './case-tracking-options.service';

@Controller('api/public/case-tracking-options')
export class CaseTrackingOptionsController {
  constructor(private readonly optionsService: CaseTrackingOptionsService) {}

  @Public()
  @Get()
  getOptions() {
    return this.optionsService.getOptions();
  }
}
