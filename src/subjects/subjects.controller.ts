import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, CurrentUser, PermissionsGuard, RequirePermission } from '../auth';
import type { AuthenticatedRequestUser } from '../auth';
import { CreateSubjectDto, ListSubjectsQueryDto, UpdateSubjectDto } from './dto/subjects.dto';
import { SubjectsService } from './subjects.service';

@UseGuards(AuthGuard)
@Controller('api/subjects')
export class SubjectsController {
  constructor(private readonly subjectsService: SubjectsService) {}

  // Open to any authenticated user (no extra permission) — attendance-link
  // creation needs the subject combobox regardless of who holds `manage-timetable`.
  @Get()
  async list(@Query() query: ListSubjectsQueryDto) {
    return await this.subjectsService.list(query);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('manage-timetable')
  @Post()
  async create(@CurrentUser() actor: AuthenticatedRequestUser, @Body() body: CreateSubjectDto) {
    return await this.subjectsService.create(actor, body);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('manage-timetable')
  @Patch(':id')
  async update(
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateSubjectDto,
  ) {
    return await this.subjectsService.update(actor, id, body);
  }
}
