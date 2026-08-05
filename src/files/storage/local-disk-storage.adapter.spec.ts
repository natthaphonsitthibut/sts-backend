import { mkdtempSync, rmSync } from 'fs';
import { readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';
import { LocalDiskStorageAdapter } from './local-disk-storage.adapter';

describe('LocalDiskStorageAdapter', () => {
  let dir: string;
  let adapter: LocalDiskStorageAdapter;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sts-local-storage-spec-'));
    adapter = new LocalDiskStorageAdapter({ uploadsDir: dir } as never);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes the exact bytes given to save()', async () => {
    const buffer = Buffer.from('hello visit photo');
    await adapter.save(buffer, 'a1b2.jpg');

    const written = await readFile(join(dir, 'a1b2.jpg'));
    expect(written.equals(buffer)).toBe(true);
  });

  it('streams bytes to disk without requiring a whole-file buffer', async () => {
    await adapter.saveStream(Readable.from(['first', '-', 'second']), 'data-exports/job.csv');

    const written = await readFile(join(dir, 'data-exports/job.csv'));
    expect(written.toString()).toBe('first-second');
  });

  it('creates the uploads directory on first save if missing', async () => {
    const nested = join(dir, 'nested', 'path');
    const nestedAdapter = new LocalDiskStorageAdapter({ uploadsDir: nested } as never);
    await nestedAdapter.save(Buffer.from('x'), 'f.png');

    const written = await readFile(join(nested, 'f.png'));
    expect(written.toString()).toBe('x');
  });

  it('resolves an existing file as a local serve result', async () => {
    await adapter.save(Buffer.from('data'), 'exists.png');

    const result = await adapter.resolve('exists.png');

    expect(result).toEqual({ kind: 'local', filePath: join(dir, 'exists.png') });
  });

  it('returns null for a file that does not exist', async () => {
    const result = await adapter.resolve('missing.png');
    expect(result).toBeNull();
  });

  it('returns null (does not escape the uploads dir) for a path-traversal filename', async () => {
    const result = await adapter.resolve('../outside.png');
    expect(result).toBeNull();
  });

  it('deletes a stored object idempotently', async () => {
    await adapter.save(Buffer.from('temporary'), 'data-exports/job.csv');

    await adapter.delete('data-exports/job.csv');
    await adapter.delete('data-exports/job.csv');

    await expect(adapter.open('data-exports/job.csv')).resolves.toBeNull();
  });
});
