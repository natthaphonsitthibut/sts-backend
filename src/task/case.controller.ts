import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  ParseIntPipe,
  Param,
  Post,
} from '@nestjs/common';
import { CaseService } from './case.service';
import { ReviewCaseDto } from './dto/task.dto';
import { getTaskErrorMessage } from './task.types';

@Controller('api/cases')
export class CaseController {
  constructor(private readonly caseService: CaseService) {}

  @Post(':caseId/review')
  async reviewCase(@Param('caseId', ParseIntPipe) caseId: number, @Body() body: ReviewCaseDto) {
    try {
      return await this.caseService.reviewCase(caseId, body);
    } catch (err) {
      const message = getTaskErrorMessage(err);
      const status = message === 'Case not found' ? HttpStatus.NOT_FOUND : HttpStatus.BAD_REQUEST;
      throw new HttpException(message, status);
    }
  }

  @Get(':caseId/tasks')
  async getCaseTasks(@Param('caseId', ParseIntPipe) caseId: number) {
    try {
      return await this.caseService.getTasksByCase(caseId);
    } catch (err) {
      const message = getTaskErrorMessage(err);
      const status = message === 'Case not found' ? HttpStatus.NOT_FOUND : HttpStatus.BAD_REQUEST;
      throw new HttpException(message, status);
    }
  }

  @Get(':caseId/reviews')
  async getCaseReviews(@Param('caseId', ParseIntPipe) caseId: number) {
    try {
      return await this.caseService.getCaseReviews(caseId);
    } catch (err) {
      const message = getTaskErrorMessage(err);
      const status = message === 'Case not found' ? HttpStatus.NOT_FOUND : HttpStatus.BAD_REQUEST;
      throw new HttpException(message, status);
    }
  }
}
