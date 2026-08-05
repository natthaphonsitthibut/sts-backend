import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name);

  constructor(private readonly dataSource: DataSource) {}

  getHello(): string {
    return 'Hello World!';
  }

  async getReadiness(): Promise<{ status: 'ok'; checks: { database: 'up' } }> {
    try {
      await this.dataSource.query('SELECT 1');
      return { status: 'ok', checks: { database: 'up' } };
    } catch {
      this.logger.warn('Database readiness check failed.');
      throw new ServiceUnavailableException('Service is not ready');
    }
  }
}
