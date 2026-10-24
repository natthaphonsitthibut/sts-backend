import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { OpenAPIObject } from '@nestjs/swagger';

type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface CatalogResponse {
  description: string;
  schema?: Record<string, unknown>;
  example?: unknown;
  /** Non-JSON success body, e.g. image/jpeg or text/csv. */
  contentType?: string;
  /** Response headers with example values, e.g. Location on a redirect. */
  headers?: Record<string, string>;
  /** Raw HTTP example for bodies that are not JSON (files, redirects, 204). */
  exampleText?: string;
}

export interface ApiCatalogEntry {
  id: string;
  tag: string;
  summary: string;
  description?: string;
  deprecated?: boolean;
  responses?: Record<string, CatalogResponse>;
  requestExample?: unknown;
  parameterExamples?: Record<string, unknown>;
}

export interface ApiCatalog {
  tags: Array<{ name: string; description: string }>;
  /** key = "METHOD /openapi/path" */
  operations: Record<string, ApiCatalogEntry>;
}

const CATALOG_FILE = join(__dirname, 'api-catalog.data.json');

export function loadApiCatalog(): ApiCatalog | null {
  if (!existsSync(CATALOG_FILE)) return null;
  return JSON.parse(readFileSync(CATALOG_FILE, 'utf8')) as ApiCatalog;
}

function toOpenApiResponse(response: CatalogResponse) {
  const headers = response.headers
    ? Object.fromEntries(
        Object.entries(response.headers).map(([name, example]) => [
          name,
          { schema: { type: 'string' as const }, example },
        ]),
      )
    : undefined;
  if (response.contentType) {
    return {
      description: response.description,
      ...(headers ? { headers } : {}),
      content: {
        [response.contentType]: {
          schema: { type: 'string' as const, format: 'binary' },
          ...(response.exampleText ? { example: response.exampleText } : {}),
        },
      },
    };
  }
  const hasBody = response.schema !== undefined || response.example !== undefined;
  return {
    description: response.description,
    ...(headers ? { headers } : {}),
    ...(hasBody
      ? {
          content: {
            'application/json': {
              ...(response.schema !== undefined ? { schema: response.schema } : {}),
              ...(response.example !== undefined ? { example: response.example } : {}),
            },
          },
        }
      : {}),
  };
}

/** Merge the catalog (Thai summaries, status codes, examples) into the generated document. */
export function applyApiCatalog(
  document: OpenAPIObject,
  catalog: ApiCatalog | null = loadApiCatalog(),
): OpenAPIObject {
  if (!catalog) return document;
  document.tags = catalog.tags;
  for (const [path, item] of Object.entries(document.paths)) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete'] as HttpMethod[]) {
      const operation = item[method];
      if (!operation) continue;
      const entry = catalog.operations[`${method.toUpperCase()} ${path}`];
      if (!entry) continue;
      operation.operationId = entry.deprecated ? `${entry.id}-legacy` : entry.id;
      operation.tags = [entry.tag];
      operation.summary = entry.summary;
      if (entry.description) operation.description = entry.description;
      if (entry.deprecated) operation.deprecated = true;
      if (entry.parameterExamples && operation.parameters) {
        for (const parameter of operation.parameters) {
          if ('name' in parameter && parameter.name in entry.parameterExamples) {
            parameter.example = entry.parameterExamples[parameter.name];
          }
        }
      }
      if (
        entry.requestExample !== undefined &&
        operation.requestBody &&
        'content' in operation.requestBody
      ) {
        for (const media of Object.values(operation.requestBody.content)) {
          media.example = entry.requestExample;
        }
      }
      if (entry.responses) {
        const responses: typeof operation.responses = {};
        for (const [status, response] of Object.entries(entry.responses)) {
          responses[status] = toOpenApiResponse(response);
        }
        operation.responses = responses;
      }
    }
  }
  return document;
}
