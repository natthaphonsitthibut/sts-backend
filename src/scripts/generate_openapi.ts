import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { buildOpenApiDocument } from '../openapi/openapi-document';

/**
 * Writes the OpenAPI document to a file without connecting to the database:
 * preview mode builds the module graph and routes but does not run providers.
 *   node dist/scripts/generate_openapi.js [out=openapi/openapi.json]
 */
async function main() {
  const out = resolve(process.argv[2] || 'openapi/openapi.json');
  const app = await NestFactory.create(AppModule, {
    preview: true,
    logger: false,
    abortOnError: false,
  });
  const document = buildOpenApiDocument(app, process.env.AUTH_COOKIE_NAME?.trim() || 'sts_session');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(document, null, 2)}\n`);
  const operations = Object.values(document.paths).reduce(
    (n, item) => n + Object.keys(item).length,
    0,
  );
  new Logger('OpenAPI').log(`${operations} operations -> ${out}`);
  await app.close();
}

void main();
