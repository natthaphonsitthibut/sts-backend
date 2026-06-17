import { Body, Controller, Post } from '@nestjs/common';
import { ThrottleMockLogin } from '../config/throttle.decorators';
import { MockThaIdLoginDto } from './dto/auth.dto';
import { StudentAuthService } from './student-auth.service';

@Controller('api/auth/thaid')
export class AuthController {
  constructor(private readonly studentAuthService: StudentAuthService) {}

  @ThrottleMockLogin()
  @Post('mock/login')
  async loginWithMockThaId(@Body() body: MockThaIdLoginDto) {
    return await this.studentAuthService.loginWithMockThaId(body.personId);
  }
}
