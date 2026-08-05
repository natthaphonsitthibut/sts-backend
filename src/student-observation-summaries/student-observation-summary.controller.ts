import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  AuthGuard,
  CurrentUser,
  PermissionsGuard,
  RequirePermission,
  type AuthenticatedRequestUser,
} from '../auth';
import {
  GenerateObservationSummaryDto,
  ReviewObservationSummaryDto,
} from './dto/student-observation-summary.dto';
import { StudentObservationSummaryService } from './student-observation-summary.service';

@UseGuards(AuthGuard, PermissionsGuard)
@RequirePermission('manage-student-observations')
@Controller('api/students/:studentTermId/observation-summary')
export class StudentObservationSummaryController {
  constructor(private readonly service: StudentObservationSummaryService) {}

  @Post()
  generate(
    @Param('studentTermId', ParseUUIDPipe) studentTermId: string,
    @Body() body: GenerateObservationSummaryDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.generate(studentTermId, body, actor);
  }

  @Get()
  get(
    @Param('studentTermId', ParseUUIDPipe) studentTermId: string,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.get(studentTermId, actor);
  }

  @Patch(':summaryId/review')
  review(
    @Param('studentTermId', ParseUUIDPipe) studentTermId: string,
    @Param('summaryId', ParseUUIDPipe) summaryId: string,
    @Body() body: ReviewObservationSummaryDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.review(studentTermId, summaryId, body, actor);
  }
}
