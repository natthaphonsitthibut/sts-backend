import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  AuthGuard,
  CurrentUser,
  PermissionsGuard,
  RequireAnyPermission,
  RequirePermission,
  type AuthenticatedRequestUser,
} from '../auth';
import {
  CreateStudentStatusDto,
  ListStudentStatusesQueryDto,
  UpdateStudentStatusDto,
} from './dto/student-status.dto';
import { StudentStatusService } from './student-status.service';

@UseGuards(AuthGuard, PermissionsGuard)
@Controller('api/student-statuses')
export class StudentStatusController {
  constructor(private readonly service: StudentStatusService) {}

  // Read access also covers import admins — the quarantine fix dialog needs
  // the status list to offer a picker without granting settings management.
  @Get()
  @RequireAnyPermission('settings', 'import-data')
  list(@Query() query: ListStudentStatusesQueryDto) {
    return this.service.list(query);
  }

  @Get(':code')
  @RequirePermission('settings')
  getByCode(@Param('code', ParseIntPipe) code: number) {
    return this.service.getByCode(code);
  }

  @Post()
  @RequirePermission('settings')
  create(@CurrentUser() actor: AuthenticatedRequestUser, @Body() body: CreateStudentStatusDto) {
    return this.service.create(actor, body);
  }

  @Put(':code')
  @RequirePermission('settings')
  update(
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Param('code', ParseIntPipe) code: number,
    @Body() body: UpdateStudentStatusDto,
  ) {
    return this.service.update(actor, code, body);
  }

  @Delete(':code')
  @RequirePermission('settings')
  disable(
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Param('code', ParseIntPipe) code: number,
  ) {
    return this.service.disable(actor, code);
  }
}
