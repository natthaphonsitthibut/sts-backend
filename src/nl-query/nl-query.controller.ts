import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  AuthGuard,
  CurrentUser,
  PermissionsGuard,
  RequirePermission,
  type AuthenticatedRequestUser,
} from '../auth';
import { ThrottleNlQuery } from '../config/throttle.decorators';
import {
  ListConversationsQueryDto,
  NlQueryDto,
  RenameConversationDto,
  type NlQueryResponse,
  type SchemaResponse,
} from './dto/nl-query.dto';
import {
  NlConversationService,
  type ConversationDetail,
  type ConversationSummary,
} from './nl-conversation.service';
import { NlQueryService } from './nl-query.service';

const DEFAULT_PAGE_SIZE = 30;

@UseGuards(AuthGuard, PermissionsGuard)
@Controller('api/nl-query')
export class NlQueryController {
  constructor(
    private readonly nlQueryService: NlQueryService,
    private readonly conversations: NlConversationService,
  ) {}

  @Post()
  @RequirePermission('nl_query:use')
  @ThrottleNlQuery()
  async ask(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Body() dto: NlQueryDto,
  ): Promise<NlQueryResponse> {
    return await this.nlQueryService.query(dto, user);
  }

  @Get('schema')
  @RequirePermission('nl_query:use')
  async schema(): Promise<SchemaResponse> {
    return await this.nlQueryService.schema();
  }

  @Get('conversations')
  @RequirePermission('nl_query:use')
  async listConversations(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Query() query: ListConversationsQueryDto,
  ): Promise<{ items: ConversationSummary[]; next_before: string | null }> {
    return await this.conversations.list(user.id, {
      limit: query.limit ?? DEFAULT_PAGE_SIZE,
      before: query.before,
    });
  }

  @Get('conversations/:id')
  @RequirePermission('nl_query:use')
  async getConversation(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ConversationDetail> {
    return await this.conversations.get(user.id, id);
  }

  @Patch('conversations/:id')
  @RequirePermission('nl_query:use')
  async renameConversation(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenameConversationDto,
  ): Promise<ConversationSummary> {
    return await this.conversations.rename(user.id, id, dto.title);
  }

  @Delete('conversations/:id')
  @HttpCode(204)
  @RequirePermission('nl_query:use')
  async deleteConversation(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.conversations.remove(user.id, id);
  }
}
