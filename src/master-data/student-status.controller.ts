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
@RequirePermission('settings')
@Controller('api/student-statuses')
export class StudentStatusController {
  constructor(private readonly service: StudentStatusService) {}

  @Get()
  list(@Query() query: ListStudentStatusesQueryDto) {
    return this.service.list(query);
  }

  @Get(':code')
  getByCode(@Param('code', ParseIntPipe) code: number) {
    return this.service.getByCode(code);
  }

  @Post()
  create(@CurrentUser() actor: AuthenticatedRequestUser, @Body() body: CreateStudentStatusDto) {
    return this.service.create(actor, body);
  }

  @Put(':code')
  update(
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Param('code', ParseIntPipe) code: number,
    @Body() body: UpdateStudentStatusDto,
  ) {
    return this.service.update(actor, code, body);
  }

  @Delete(':code')
  disable(
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Param('code', ParseIntPipe) code: number,
  ) {
    return this.service.disable(actor, code);
  }
}
