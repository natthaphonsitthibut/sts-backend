import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import {
  AuthGuard,
  CurrentUser,
  PermissionsGuard,
  RequirePermission,
  type AuthenticatedRequestUser,
} from '../auth';
import { ThrottleNlQuery } from '../config/throttle.decorators';
import { NlQueryDto, type QueryEnvelope, type SchemaResponse } from './dto/nl-query.dto';
import { NlQueryService } from './nl-query.service';

@UseGuards(AuthGuard, PermissionsGuard)
@Controller('api/nl-query')
export class NlQueryController {
  constructor(private readonly nlQueryService: NlQueryService) {}

  @Post()
  @RequirePermission('nl_query:use')
  @ThrottleNlQuery()
  async ask(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Body() dto: NlQueryDto,
  ): Promise<QueryEnvelope> {
    return await this.nlQueryService.query(dto, user);
  }

  @Get('schema')
  @RequirePermission('nl_query:use')
  async schema(): Promise<SchemaResponse> {
    return await this.nlQueryService.schema();
  }
}
