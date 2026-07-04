import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DataSource } from 'typeorm';
import { ServiceUnavailableException } from '@nestjs/common';

describe('AppController', () => {
  let appController: AppController;
  const query = jest.fn();

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService, { provide: DataSource, useValue: { query } }],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });

  describe('health', () => {
    it('should return an ok status for platform health checks', () => {
      expect(appController.getHealth()).toEqual({ status: 'ok' });
    });

    it('reports ready only when the database responds', async () => {
      query.mockResolvedValueOnce([{ '?column?': 1 }]);

      await expect(appController.getReadiness()).resolves.toEqual({
        status: 'ok',
        checks: { database: 'up' },
      });
      expect(query).toHaveBeenCalledWith('SELECT 1');
    });

    it('returns service unavailable when the database check fails', async () => {
      query.mockRejectedValueOnce(new Error('connection failed'));

      await expect(appController.getReadiness()).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });
  });
});
