import { SupabaseStorageAdapter } from './supabase-storage.adapter';
import { Readable } from 'stream';

function config(overrides: Partial<{ supabaseUrl: string; supabaseServiceRoleKey: string }> = {}) {
  return {
    supabaseUrl: 'https://project-ref.supabase.co',
    supabaseServiceRoleKey: 'service-role-secret',
    supabaseBucket: 'uploads',
    signedUrlTtlSeconds: 60,
    ...overrides,
  } as never;
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

describe('SupabaseStorageAdapter', () => {
  let fetchSpy: jest.SpyInstance;

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe('save', () => {
    it('POSTs the buffer to the object endpoint with the service-role bearer token', async () => {
      fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(200, {}));
      const adapter = new SupabaseStorageAdapter(config());
      const buffer = Buffer.from('photo bytes');

      await adapter.save(buffer, 'abc123.jpg');

      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://project-ref.supabase.co/storage/v1/object/uploads/abc123.jpg');
      expect(init.method).toBe('POST');
      expect(init.body).toBe(buffer);
      expect(init.headers).toEqual(
        expect.objectContaining({
          Authorization: 'Bearer service-role-secret',
          apikey: 'service-role-secret',
          'x-upsert': 'true',
        }),
      );
    });

    it('throws when the upload response is not ok', async () => {
      fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(jsonResponse(500, { error: 'boom' }));
      const adapter = new SupabaseStorageAdapter(config());

      await expect(adapter.save(Buffer.from('x'), 'f.png')).rejects.toThrow(/upload failed/i);
    });
  });

  describe('saveStream', () => {
    it('POSTs a Node stream with the required half-duplex fetch option', async () => {
      fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(200, {}));
      const adapter = new SupabaseStorageAdapter(config());
      const source = Readable.from(['csv']);

      await adapter.saveStream(source, 'data-exports/job.csv');

      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit & { duplex?: string }];
      expect(init.body).toBe(source);
      expect(init.duplex).toBe('half');
    });
  });

  describe('resolve', () => {
    it('signs the object and prefixes a relative signedURL with the storage base URL', async () => {
      fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(
          jsonResponse(200, { signedURL: '/object/sign/uploads/abc123.jpg?token=t1' }),
        );
      const adapter = new SupabaseStorageAdapter(config());

      const result = await adapter.resolve('abc123.jpg');

      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://project-ref.supabase.co/storage/v1/object/sign/uploads/abc123.jpg');
      expect(init.method).toBe('POST');
      expect(init.body).toBe(JSON.stringify({ expiresIn: 60 }));
      expect(result).toEqual({
        kind: 'redirect',
        url: 'https://project-ref.supabase.co/storage/v1/object/sign/uploads/abc123.jpg?token=t1',
      });
    });

    it('passes an already-absolute signedURL through unchanged', async () => {
      fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(
          jsonResponse(200, { signedURL: 'https://cdn.example/abc123.jpg?token=t1' }),
        );
      const adapter = new SupabaseStorageAdapter(config());

      const result = await adapter.resolve('abc123.jpg');

      expect(result).toEqual({ kind: 'redirect', url: 'https://cdn.example/abc123.jpg?token=t1' });
    });

    it('returns null when the object is not found', async () => {
      fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(jsonResponse(404, { error: 'not found' }));
      const adapter = new SupabaseStorageAdapter(config());

      const result = await adapter.resolve('missing.jpg');

      expect(result).toBeNull();
    });

    it('throws on an unexpected error status', async () => {
      fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(jsonResponse(500, { error: 'boom' }));
      const adapter = new SupabaseStorageAdapter(config());

      await expect(adapter.resolve('abc123.jpg')).rejects.toThrow(/sign failed/i);
    });
  });

  describe('delete', () => {
    it('deletes a private object using server credentials', async () => {
      fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(200, {}));
      const adapter = new SupabaseStorageAdapter(config());

      await adapter.delete('data-exports/job.csv');

      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        'https://project-ref.supabase.co/storage/v1/object/uploads/data-exports/job.csv',
      );
      expect(init.method).toBe('DELETE');
      expect(init.headers).toEqual(
        expect.objectContaining({ Authorization: 'Bearer service-role-secret' }),
      );
    });

    it('treats an already-missing object as deleted', async () => {
      fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(jsonResponse(404, { error: 'not found' }));
      const adapter = new SupabaseStorageAdapter(config());

      await expect(adapter.delete('missing.csv')).resolves.toBeUndefined();
    });
  });
});
