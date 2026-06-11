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

  app.enableCors({
    origin: runtimeConfig.corsOrigins.length > 0 ? runtimeConfig.corsOrigins : true,
  });
  app.useStaticAssets(runtimeConfig.uploadsDir, {
    prefix: runtimeConfig.uploadsPrefix,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: false,
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
