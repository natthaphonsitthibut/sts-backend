import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { ConfigType } from '@nestjs/config';
import { AppModule } from './app.module';
import { AppExceptionFilter } from './common/filters/app-exception.filter';
import { createValidationException } from './common/validation/validation-exception.factory';
import { appConfig } from './config/app.config';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const runtimeConfig = app.get<ConfigType<typeof appConfig>>(appConfig.KEY);

  // Controls how the real client IP is derived from X-Forwarded-For for rate
  // limiting. Default 0 (trust none = socket IP). Behind a known proxy set
  // TRUST_PROXY to the trusted hop count; never a blanket `true` (spoofable).
  app.set('trust proxy', runtimeConfig.trustProxy);

  // In production an empty allowlist would reflect ANY origin (`origin: true`),
  // which combined with `credentials: true` lets any site make authenticated
  // cross-origin requests. Fail closed instead: production MUST set CORS_ORIGINS.
  if (runtimeConfig.isProduction && runtimeConfig.corsOrigins.length === 0) {
    throw new Error(
      '[config] CORS_ORIGINS must be set in production (comma-separated allowlist); refusing to reflect every origin.',
    );
  }
  app.enableCors({
    origin: runtimeConfig.corsOrigins.length > 0 ? runtimeConfig.corsOrigins : true,
    // Required so the browser sends/accepts the httpOnly session cookie cross-origin.
    credentials: true,
  });
  // Uploaded visit photos are sensitive minor PII and are NOT served as public
  // static files. They are streamed only through the guarded FilesController
  // (auth + 'students' permission). See src/files/files.controller.ts.
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      // Strip properties that have no validation decorator (mass-assignment
      // defense). NOT using forbidNonWhitelisted yet: some clients still send
      // extra body fields (e.g. user save sends `id`/`labels`), so we silently
      // strip rather than 400 until the FE/BE payload contracts are aligned.
      whitelist: true,
      forbidUnknownValues: false,
      transformOptions: {
        enableImplicitConversion: true,
      },
      exceptionFactory: createValidationException,
    }),
  );
  app.useGlobalFilters(new AppExceptionFilter());

  await app.listen(runtimeConfig.port);
}
void bootstrap();
