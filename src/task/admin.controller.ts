import {
  Controller,
  Post,
  Body,
  Param,
  HttpException,
  HttpStatus,
  Req,
  UseGuards,
} from '@nestjs/common';
import { TaskService } from './task.service';
import { AuthGuard } from '../auth';
import { AdminLockLinkDto } from './dto/task.dto';
import { getTaskErrorMessage, hasHttpStatusGetter, type RequestWithActor } from './task.types';

@Controller('api/task-links')
export class AdminController {
  constructor(private readonly taskService: TaskService) {}

  @UseGuards(AuthGuard)
  @Post(':linkId/admin-lock')
  async adminLockLink(
    @Param('linkId') linkId: string,
    @Body() body: AdminLockLinkDto,
    @Req() req: RequestWithActor,
  ) {
    try {
      const action = body.action;
      if (!action) {
        throw new HttpException('action must be lock or unlock', HttpStatus.BAD_REQUEST);
      }

      return await this.taskService.adminLockLink(req.user, linkId, action, body.reason);
    } catch (err) {
      const status = hasHttpStatusGetter(err) ? err.getStatus() : HttpStatus.BAD_REQUEST;
      const message = getTaskErrorMessage(err);
      throw new HttpException(message, status);
    }
  }
}
