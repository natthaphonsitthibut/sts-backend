import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../auth';
import type { DataScope } from '../auth';
import { ExceptionAttendanceService } from '../attendance/exception-attendance.service';
import { ThrottleTeacherAccess } from '../config/throttle.decorators';
import { CreateClassroomStudentCommentDto } from '../school-structure/dto/school-structure.dto';
import { SchoolStructureService } from '../school-structure/school-structure.service';
import { CaseService } from '../task/case.service';
import { TeacherCommentsService } from '../teacher-comments/teacher-comments.service';
import { PiiRevealDto } from '../students/dto/pii-reveal.dto';
import { listStaffPiiRevealReasons } from '../students/pii-fields.config';
import { GetStudentSubjectAttendanceQueryDto } from '../students/dto/students.dto';
import { StudentsService } from '../students/students.service';
import {
  CLASSROOM_LINK_API_PATH,
  CLASSROOM_LINK_LEGACY_API_PATH,
} from './classroom-attendance-links.constants';
import { OpenClassroomLinkCaseDto } from './dto/classroom-attendance-links.dto';
import { ClassroomAttendanceLinksService } from './classroom-attendance-links.service';
import { ClassroomLinkCookieService } from './classroom-link-cookie.service';

/** Express gives a repeated header as an array; the log records one value. */
function firstHeaderValue(value: string | string[] | undefined): string | null {
  const resolved = Array.isArray(value) ? value[0] : value;
  return resolved?.trim() || null;
}

/**
 * The student profile as seen from a classroom link.
 *
 * A teacher who opens a classroom link works the room: the roster, attendance,
 * and the profile behind each student's avatar. These routes serve that profile
 * from the same `StudentsService` the staff screens use, so a link never grows
 * its own drifting copy of the data.
 *
 * What keeps it safe is not the permission (there is no user account here) but
 * the classroom bound to the link session: every route asserts the student is
 * on that classroom's roster, and reads run under a scope narrowed to that
 * school and room. Sensitive fields arrive masked exactly as they do for staff.
 */
@Public()
@Controller([CLASSROOM_LINK_API_PATH, CLASSROOM_LINK_LEGACY_API_PATH])
export class ClassroomLinkStudentsController {
  constructor(
    private readonly service: ClassroomAttendanceLinksService,
    private readonly cookies: ClassroomLinkCookieService,
    private readonly exceptionAttendance: ExceptionAttendanceService,
    private readonly students: StudentsService,
    private readonly schoolStructure: SchoolStructureService,
    private readonly teacherComments: TeacherCommentsService,
    private readonly caseService: CaseService,
  ) {}

  /**
   * The reveal-reason catalog. It holds no personal data, but the picker is
   * useless without it, so the link serves the same list the staff dialog uses
   * — to a caller holding a valid link session.
   */
  @Get('pii/reveal-options')
  @ThrottleTeacherAccess()
  async revealOptions(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'private, no-store');
    await this.service.authorizeCheckInSession(this.cookies.read(request.headers.cookie));
    return { data: listStaffPiiRevealReasons() };
  }

  /**
   * The pickers the comment form needs. They are plain catalogs with no personal
   * data in them, served from the same service the staff dialog reads so the two
   * forms can never offer different options.
   */
  @Get('students/comment-options')
  @ThrottleTeacherAccess()
  async commentOptions(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'private, no-store');
    await this.service.authorizeCheckInSession(this.cookies.read(request.headers.cookie));
    const [problemCategories, concernLevels] = await Promise.all([
      this.schoolStructure.listStudentProblemCategories(),
      this.schoolStructure.listStudentCommentConcernLevels(),
    ]);
    return {
      data: {
        problemCategories: problemCategories.data,
        concernLevels: concernLevels.data,
      },
    };
  }

  @Get('students/:studentId')
  @ThrottleTeacherAccess()
  async findOne(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const scope = await this.authorize(request, studentId, response);
    return await this.students.findOne(studentId, undefined, scope);
  }

  @Get('students/:studentId/profile-summary')
  @ThrottleTeacherAccess()
  async profileSummary(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const scope = await this.authorize(request, studentId, response);
    return await this.students.getStudentProfileSummary(studentId, undefined, scope);
  }

  @Get('students/:studentId/cases')
  @ThrottleTeacherAccess()
  async cases(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const scope = await this.authorize(request, studentId, response);
    return await this.students.findCasesByStudentId(studentId, undefined, scope);
  }

  @Get('students/:studentId/attendance')
  @ThrottleTeacherAccess()
  async attendance(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const scope = await this.authorize(request, studentId, response);
    return await this.students.findAttendanceByStudentId(studentId, undefined, scope);
  }

  @Get('students/:studentId/attendance-subjects')
  @ThrottleTeacherAccess()
  async attendanceSubjects(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Query() query: GetStudentSubjectAttendanceQueryDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const scope = await this.authorize(request, studentId, response);
    return await this.students.getStudentSubjectAttendance(studentId, query.date, undefined, scope);
  }

  /**
   * Unmasks one field group for a student on the link's roster.
   *
   * The owner allowed this because a link is never anonymous: the teacher signs
   * in with Google or AraID first, so the access log can name them. It does —
   * `actor_teacher_membership_id` records the teacher and `purpose_link_id` the
   * link, since a link teacher has no user row for `actor_user_id`.
   */
  @Post('students/:studentId/pii-reveal')
  @ThrottleTeacherAccess()
  async revealPii(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() body: PiiRevealDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { scope, authorized } = await this.authorizeSession(request, studentId, response);
    return await this.students.revealPii(studentId, undefined, scope, body, {
      ip: request.ip ?? null,
      userAgent: firstHeaderValue(request.headers['user-agent']),
      requestId: firstHeaderValue(request.headers['x-request-id']),
      linkActor: {
        teacherMembershipId: Number(authorized.teacherMembershipId),
        purposeLinkId: String(authorized.linkId),
      },
    });
  }

  @Get('students/:studentId/comments')
  @ThrottleTeacherAccess()
  async comments(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { authorized } = await this.authorizeSession(request, studentId, response);
    return await this.teacherComments.listStudentCommentsForLink(studentId, {
      schoolId: authorized.schoolId,
      teacherId: authorized.teacherId,
      displayName: authorized.teacherDisplayName,
    });
  }

  /**
   * A teacher's note about a student, written from the link.
   *
   * The same note the staff dialog writes, through the same service — only the
   * author differs: a link teacher has no account, so the comment records the
   * `teachers` row the link signed them in as, which is what the table's author
   * CHECK already allows for.
   */
  @Post('students/:studentId/comments')
  @ThrottleTeacherAccess()
  async createComment(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() body: CreateClassroomStudentCommentDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { authorized } = await this.authorizeSession(request, studentId, response);
    return await this.schoolStructure.createStudentCommentFromLink(
      authorized.classroomId,
      studentId,
      body,
      { teacherId: authorized.teacherId, displayName: authorized.teacherDisplayName },
    );
  }

  /**
   * Opens a follow-up case on a student from the link.
   *
   * The staff profile offers this and the link's profile is the same page, so
   * it offers it too. The case records the teacher the link signed in as, since
   * `created_by` has no account to point at here.
   */
  @Post('students/:studentId/cases')
  @ThrottleTeacherAccess()
  async openCase(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() body: OpenClassroomLinkCaseDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { authorized } = await this.authorizeSession(request, studentId, response);
    return await this.caseService.openCaseFromLink(
      { student_id: studentId, reason: body.reason },
      {
        schoolId: authorized.schoolId,
        teacherId: authorized.teacherId,
        displayName: authorized.teacherDisplayName,
      },
    );
  }

  /**
   * Resolves the link session, proves the student belongs to its classroom, and
   * returns the scope the read runs under. The classroom comes from the signed
   * session — nothing the caller sends can widen it.
   */
  private async authorize(
    request: Request,
    studentId: string,
    response: Response,
  ): Promise<DataScope> {
    return (await this.authorizeSession(request, studentId, response)).scope;
  }

  private async authorizeSession(request: Request, studentId: string, response: Response) {
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Pragma', 'no-cache');
    const authorized = await this.service.authorizeCheckInSession(
      this.cookies.read(request.headers.cookie),
    );
    await this.exceptionAttendance.assertStudentInClassroom(
      {
        source: 'CLASSROOM_LINK',
        schoolId: authorized.schoolId,
        classroomId: authorized.classroomId,
        actorUserId: null,
        teacherMembershipId: authorized.teacherMembershipId,
        actorLabel: authorized.teacherDisplayName,
      },
      studentId,
    );
    return {
      authorized,
      // The classroom bound is the roster check above — it names the exact
      // classroom. The scope carries the school and stops there on purpose:
      // `room_ids` filters on the legacy room number (`RoomID_Onec`), not on a
      // classroom id, so narrowing with one here matched nothing outside a
      // fixture where the two happened to be equal and turned every profile
      // read into a 404.
      scope: { school_ids: [authorized.schoolId] } satisfies DataScope,
    };
  }
}
