import { Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { authConfig } from '../config/auth.config';
import { AraIdIdentityRecordEntity, AraIdProfileEntity } from '../database/entities/araid.entities';
import { AraIdManagementController, AraIdSessionController } from './araid.controller';
import { AraIdSessionCookieService } from './araid-session-cookie.service';
import { AraIdService } from './araid.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([AraIdIdentityRecordEntity, AraIdProfileEntity]),
    JwtModule.registerAsync({
      inject: [authConfig.KEY],
      useFactory: (config: ConfigType<typeof authConfig>) => ({
        secret: config.jwtSecret,
        signOptions: { expiresIn: config.tokenTtlSeconds },
      }),
    }),
  ],
  controllers: [AraIdManagementController, AraIdSessionController],
  providers: [AraIdService, AraIdSessionCookieService],
  exports: [AraIdService, AraIdSessionCookieService],
})
export class AraIdModule {}
