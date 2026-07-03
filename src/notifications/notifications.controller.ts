import { Controller, Get, Param, ParseUUIDPipe, Patch, Query, UseGuards } from '@nestjs/common';
import { AuthGuard, CurrentUser } from '../auth';
import type { AuthenticatedRequestUser } from '../auth/auth.types';
import { ListNotificationsQueryDto } from './dto/notifications.dto';
import { NotificationsService } from './notifications.service';

/**
 * Personal inbox — every route is bound to the authenticated user; there is no
 * cross-user access and therefore no extra permission gate beyond AuthGuard.
 */
@UseGuards(AuthGuard)
@Controller('api/notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  list(@CurrentUser() actor: AuthenticatedRequestUser, @Query() query: ListNotificationsQueryDto) {
    return this.notificationsService.listForUser(actor.id, {
      unreadOnly: query.unread === true,
      page: query.page,
      limit: query.limit,
    });
  }

  @Patch('seen')
  markAllSeen(@CurrentUser() actor: AuthenticatedRequestUser) {
    return this.notificationsService.markAllSeen(actor.id);
  }

  @Patch('read-all')
  markAllRead(@CurrentUser() actor: AuthenticatedRequestUser) {
    return this.notificationsService.markAllRead(actor.id);
  }

  @Patch(':id/read')
  markRead(
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.notificationsService.markRead(actor.id, id);
  }
}
