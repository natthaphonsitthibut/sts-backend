import type { OpenAPIObject } from '@nestjs/swagger';
import { applyApiCatalog, type ApiCatalog } from './api-catalog';

function document(): OpenAPIObject {
  return {
    openapi: '3.1.0',
    info: { title: 't', version: '1' },
    paths: {
      '/api/things/{id}': {
        get: {
          operationId: 'ThingsController_get',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'number' } }],
          responses: { '200': { description: '' } },
        },
      },
      '/api/legacy/{id}': {
        get: { operationId: 'ThingsController_get[1]', responses: { '200': { description: '' } } },
      },
      '/api/untouched': {
        get: { operationId: 'Other_list', responses: { '200': { description: '' } } },
      },
    },
  };
}

const catalog: ApiCatalog = {
  tags: [{ name: 'Things (THG)', description: 'สิ่งของ' }],
  operations: {
    'GET /api/things/{id}': {
      id: 'API-THG-001',
      tag: 'Things (THG)',
      summary: 'ดูสิ่งของ',
      description: 'รายละเอียด',
      parameterExamples: { id: 7 },
      responses: {
        '200': { description: '200 OK', schema: { type: 'object' }, example: { id: 7 } },
        '404': { description: '404 Not Found' },
      },
    },
    'GET /api/legacy/{id}': {
      id: 'API-THG-001',
      tag: 'Things (THG)',
      summary: 'ดูสิ่งของ',
      deprecated: true,
    },
  },
};

describe('applyApiCatalog', () => {
  it('merges ids, Thai text, parameter examples and responses into matching operations', () => {
    const result = applyApiCatalog(document(), catalog);
    const op = result.paths['/api/things/{id}'].get!;
    expect(result.tags).toEqual(catalog.tags);
    expect(op.operationId).toBe('API-THG-001');
    expect(op.tags).toEqual(['Things (THG)']);
    expect(op.summary).toBe('ดูสิ่งของ');
    expect(op.parameters).toEqual([expect.objectContaining({ name: 'id', example: 7 })]);
    expect(op.responses['200']).toEqual({
      description: '200 OK',
      content: { 'application/json': { schema: { type: 'object' }, example: { id: 7 } } },
    });
    expect(op.responses['404']).toEqual({ description: '404 Not Found' });
  });

  it('keeps operation ids unique for legacy path aliases and marks them deprecated', () => {
    const op = applyApiCatalog(document(), catalog).paths['/api/legacy/{id}'].get!;
    expect(op.operationId).toBe('API-THG-001-legacy');
    expect(op.deprecated).toBe(true);
  });

  it('documents file and redirect responses with their content type and headers', () => {
    const doc = document();
    doc.paths['/api/things/{id}'].get!.operationId = 'x';
    const result = applyApiCatalog(doc, {
      tags: [],
      operations: {
        'GET /api/things/{id}': {
          id: 'API-THG-002',
          tag: 'Things (THG)',
          summary: 'รูป',
          responses: {
            '200': {
              description: '200 OK',
              contentType: 'image/jpeg',
              exampleText: 'HTTP/1.1 200 OK',
            },
            '302': { description: '302 Found', headers: { Location: 'https://example.org/x' } },
          },
        },
      },
    });
    const responses = result.paths['/api/things/{id}'].get!.responses;
    expect(responses['200']).toEqual({
      description: '200 OK',
      content: {
        'image/jpeg': { schema: { type: 'string', format: 'binary' }, example: 'HTTP/1.1 200 OK' },
      },
    });
    expect(responses['302']).toEqual({
      description: '302 Found',
      headers: { Location: { schema: { type: 'string' }, example: 'https://example.org/x' } },
    });
  });

  it('leaves operations without a catalog entry and documents without a catalog unchanged', () => {
    expect(applyApiCatalog(document(), catalog).paths['/api/untouched'].get!.operationId).toBe(
      'Other_list',
    );
    expect(applyApiCatalog(document(), null)).toEqual(document());
  });
});
