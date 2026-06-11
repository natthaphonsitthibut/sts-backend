import { Body, Controller, Post } from '@nestjs/common';
import { MockThaIdLoginDto } from './dto/auth.dto';
import { StudentAuthService } from './student-auth.service';

@Controller('api/auth/thaid')
export class AuthController {
  constructor(private readonly studentAuthService: StudentAuthService) {}

  @Post('mock/login')
  async loginWithMockThaId(@Body() body: MockThaIdLoginDto) {
    return await this.studentAuthService.loginWithMockThaId(body.personId);
  }
}
