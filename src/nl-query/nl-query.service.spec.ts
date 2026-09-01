import { BadGatewayException, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { AuthenticatedRequestUser } from '../auth';
import type { QueryEnvelope } from './dto/nl-query.dto';
import { NlQueryLogService } from './nl-query-log.service';
import { NlQueryService } from './nl-query.service';

const actor: AuthenticatedRequestUser = {
  id: 7,
  username: 'analyst',
  roles: ['ADMIN'],
  permissions: ['nl_query:use'],
  data_scope: { global: true },
};

const envelope: QueryEnvelope = {
  status: 'ok',
  request_id: 'request-1',
  question: 'นักเรียนทั้งหมดกี่คน',
  sql: 'SELECT COUNT(*) AS total FROM students',
  columns: [{ name: 'total', type: 'int', numeric: true, semantic_type: 'count' }],
  rows: [{ total: 10 }],
  row_count: 1,
  truncated: false,
  summary: {
    row_count: 1,
    truncated: false,
    numeric_aggregates: { total: { sum: 10, min: 10, max: 10, mean: 10 } },
    single_value: true,
  },
  visualization: {
    chart_type: 'table',
    x_col: null,
    y_col: null,
    series_col: null,
    options: [],
    title: 'นักเรียนทั้งหมดกี่คน',
    x_label: null,
    y_label: null,
    top_n: null,
    reason: null,
  },
  retry_count: 0,
  elapsed_ms: 20,
  error: null,
};

describe('NlQueryService', () => {
  let fetchMock: jest.MockedFunction<typeof fetch>;
  let log: jest.Mocked<Pick<NlQueryLogService, 'begin' | 'complete' | 'fail'>>;
  let service: NlQueryService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    log = {
      begin: jest.fn().mockResolvedValue('41'),
      complete: jest.fn().mockResolvedValue(undefined),
      fail: jest.fn().mockResolvedValue(undefined),
    };
    service = new NlQueryService(
      { url: 'http://python.test', apiKey: 'secret', timeoutMs: 60_000 },
      log as unknown as NlQueryLogService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('forwards a successful envelope unchanged and completes its audit row', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(envelope), { status: 200 }));

    await expect(service.query({ question: envelope.question }, actor)).resolves.toEqual(envelope);
    expect(log.begin).toHaveBeenCalledWith({
      userId: actor.id,
      dataScope: actor.data_scope,
      question: envelope.question,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://python.test/api/query',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': 'secret' },
      }),
    );
    expect(log.complete).toHaveBeenCalledWith(
      '41',
      expect.objectContaining({ requestId: 'request-1', status: 'ok', rowCount: 1 }),
    );
  });

  it('forwards an HTTP 200 business error without turning it into a gateway error', async () => {
    const businessError: QueryEnvelope = {
      ...envelope,
      status: 'error',
      rows: null,
      row_count: 0,
      summary: null,
      visualization: null,
      error: { code: 'EXEC_FAILED', message: 'query failed' },
    };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(businessError), { status: 200 }));

    await expect(service.query({ question: businessError.question }, actor)).resolves.toEqual(
      businessError,
    );
    expect(log.complete).toHaveBeenCalledWith(
      '41',
      expect.objectContaining({ status: 'error', errorCode: 'EXEC_FAILED' }),
    );
  });

  it('forwards an empty successful result as a business success', async () => {
    const emptyResult: QueryEnvelope = {
      ...envelope,
      columns: [],
      rows: [],
      row_count: 0,
      summary: {
        row_count: 0,
        truncated: false,
        numeric_aggregates: {},
        single_value: false,
      },
      visualization: null,
    };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(emptyResult), { status: 200 }));

    await expect(service.query({ question: emptyResult.question }, actor)).resolves.toEqual(
      emptyResult,
    );
  });

  it('fails closed without calling Python when the audit anchor cannot be created', async () => {
    log.begin.mockRejectedValue(new Error('database unavailable'));

    await expect(service.query({ question: envelope.question }, actor)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps upstream failures to 502 and marks the audit row failed', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 503 }));

    await expect(service.query({ question: envelope.question }, actor)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(log.fail).toHaveBeenCalledWith('41', 'Error: upstream 503');
    expect(log.complete).not.toHaveBeenCalled();
  });

  it('aborts a timed-out upstream request and returns 502', async () => {
    jest.useFakeTimers();
    fetchMock.mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );

    const result = service.query({ question: envelope.question }, actor);
    const rejection = expect(result).rejects.toBeInstanceOf(BadGatewayException);
    await jest.advanceTimersByTimeAsync(60_000);

    await rejection;
    expect(log.fail).toHaveBeenCalledWith('41', 'Error: aborted');
    jest.useRealTimers();
  });

  it('still returns the envelope when completing an existing audit row fails', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(envelope), { status: 200 }));
    log.complete.mockRejectedValue(new Error('update failed'));

    await expect(service.query({ question: envelope.question }, actor)).resolves.toEqual(envelope);
  });

  it('caches a successful schema response for five minutes', async () => {
    const schema = { tables: [{ name: 'students', columns: [{ name: 'id', type: 'integer' }] }] };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(schema), { status: 200 }));

    await expect(service.schema()).resolves.toEqual(schema);
    await expect(service.schema()).resolves.toEqual(schema);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://python.test/api/schema',
      expect.objectContaining({
        method: 'GET',
        headers: { 'X-API-Key': 'secret' },
      }),
    );
  });

  it('does not cache a failed schema request', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ tables: [] }), { status: 200 }));

    await expect(service.schema()).rejects.toBeInstanceOf(BadGatewayException);
    await expect(service.schema()).resolves.toEqual({ tables: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
