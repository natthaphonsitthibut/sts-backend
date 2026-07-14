import type { Readable } from 'stream';

// A caller must validate/sanitize `filename` (path traversal, charset) before
// calling these methods — adapters also enforce their own safe-path rules.
export type FileServeResult =
  | { kind: 'local'; filePath: string }
  | { kind: 'redirect'; url: string };

export interface FileStorageAdapter {
  readonly kind: 'local' | 'private-object';
  // Arrow-typed (not method-shorthand) so mocking `adapter.save`/`adapter.resolve`
  // in tests doesn't trip @typescript-eslint/unbound-method.
  save: (buffer: Buffer, filename: string) => Promise<void>;
  saveStream: (source: Readable, filename: string) => Promise<void>;
  resolve: (filename: string) => Promise<FileServeResult | null>;
  open: (filename: string) => Promise<Readable | null>;
  delete: (filename: string) => Promise<void>;
}

export const FILE_STORAGE_ADAPTER = Symbol('FILE_STORAGE_ADAPTER');
