import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  AuthGuard,
  CurrentUser,
  normalizeDataScope,
  PermissionsGuard,
  RequirePermission,
  type AuthenticatedRequestUser,
} from '../auth';
import { StudentsService } from './students.service';
import { CreateStudentDto } from './dto/create-student.dto';
import { GetStudentsQueryDto } from './dto/students.dto';
import { PiiRevealDto } from './dto/pii-reveal.dto';
import { UpdateStudentDto } from './dto/update-student.dto';

function firstHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return typeof value === 'string' && value.length > 0 ? value : null;
}

@UseGuards(AuthGuard)
@Controller('api/students')
export class StudentsController {
  constructor(private readonly studentsService: StudentsService) {}

  @Post()
  create(@Body() createStudentDto: CreateStudentDto) {
    return this.studentsService.create(createStudentDto);
  }

  @Get()
  findAll(@Query() query: GetStudentsQueryDto, @CurrentUser() actor?: AuthenticatedRequestUser) {
    return this.studentsService.findAll(query, normalizeDataScope(actor?.data_scope), actor);
  }

  @Get('cases/by-name/:name')
  findCasesByName(@Param('name') name: string, @CurrentUser() actor?: AuthenticatedRequestUser) {
    return this.studentsService.findCasesByName(name, actor);
  }

  @Get('attendance/:id')
  findAttendanceByStudentId(
    @Param('id') id: string,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return this.studentsService.findAttendanceByStudentId(
      id,
      actor,
      normalizeDataScope(actor?.data_scope),
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() actor?: AuthenticatedRequestUser) {
    return this.studentsService.findOne(id, actor, normalizeDataScope(actor?.data_scope));
  }

  // Reveal a masked PII group (national id / passport) for one student. Stricter
  // than findOne: explicit `students` permission + the actor's data scope, and
  // every reveal is recorded in the immutable pii_access_events log.
  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('students')
  @Post(':id/pii-reveal')
  revealPii(
    @Param('id') id: string,
    @Body() body: PiiRevealDto,
    @Req() req: Request,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return this.studentsService.revealPii(id, actor, normalizeDataScope(actor?.data_scope), body, {
      ip: firstHeaderValue(req.headers['x-forwarded-for']) ?? req.ip ?? null,
      userAgent: firstHeaderValue(req.headers['user-agent']),
      requestId: firstHeaderValue(req.headers['x-request-id']),
    });
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateStudentDto: UpdateStudentDto) {
    return this.studentsService.update(+id, updateStudentDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.studentsService.remove(+id);
  }
}
