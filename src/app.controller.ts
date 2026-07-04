import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  getHealth(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('health/ready')
  getReadiness(): Promise<{ status: 'ok'; checks: { database: 'up' } }> {
    return this.appService.getReadiness();
  }
}
