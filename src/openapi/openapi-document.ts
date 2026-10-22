import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { applyApiCatalog } from './api-catalog';

export const OPENAPI_UI_PATH = 'api/docs';
export const OPENAPI_JSON_PATH = 'api/docs/openapi.json';

/**
 * OpenAPI document for every controller in the app. Request bodies and query
 * DTOs come from the Nest Swagger CLI plugin (class-validator rules); summaries,
 * permissions, status codes and examples come from the API catalog.
 */
export function buildOpenApiDocument(
  app: INestApplication,
  sessionCookieName: string,
): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('STS — Student Tracking System API')
    .setDescription('API ของระบบติดตามนักเรียนกันหลุดออกจากระบบการศึกษา')
    .setVersion('1.0')
    .setOpenAPIVersion('3.1.0')
    .addServer('https://sts-frontend-gold.vercel.app', 'Production (ผ่าน proxy ของ frontend)')
    .addServer('http://localhost:3000', 'Development')
    .addCookieAuth(
      sessionCookieName,
      { type: 'apiKey', in: 'cookie', name: sessionCookieName },
      'session',
    )
    .addCookieAuth(
      'classroom_check_in_session',
      { type: 'apiKey', in: 'cookie', name: 'classroom_check_in_session' },
      'classroomLinkSession',
    )
    .addApiKey(
      { type: 'apiKey', in: 'header', name: 'x-classroom-link-token' },
      'classroomLinkToken',
    )
    .addApiKey({ type: 'apiKey', in: 'header', name: 'x-referral-session' }, 'referralSession')
    .addCookieAuth(
      'araid_session',
      { type: 'apiKey', in: 'cookie', name: 'araid_session' },
      'araidSession',
    )
    .build();
  const document = SwaggerModule.createDocument(app, config, {
    operationIdFactory: (controllerKey, methodKey) => `${controllerKey}_${methodKey}`,
  });
  return applyApiCatalog(document);
}
