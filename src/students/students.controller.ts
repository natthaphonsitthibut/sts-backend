import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, CurrentUser, normalizeDataScope, type AuthenticatedRequestUser } from '../auth';
import { StudentsService } from './students.service';
import { CreateStudentDto } from './dto/create-student.dto';
import { GetStudentsQueryDto } from './dto/students.dto';
import { UpdateStudentDto } from './dto/update-student.dto';

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

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateStudentDto: UpdateStudentDto) {
    return this.studentsService.update(+id, updateStudentDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.studentsService.remove(+id);
  }
}
