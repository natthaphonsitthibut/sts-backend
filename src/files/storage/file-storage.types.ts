// A caller must validate/sanitize `filename` (path traversal, charset) before
// calling either method here — these adapters trust the filename they're given.
export type FileServeResult =
  | { kind: 'local'; filePath: string }
  | { kind: 'redirect'; url: string };

export interface FileStorageAdapter {
  // Arrow-typed (not method-shorthand) so mocking `adapter.save`/`adapter.resolve`
  // in tests doesn't trip @typescript-eslint/unbound-method.
  save: (buffer: Buffer, filename: string) => Promise<void>;
  resolve: (filename: string) => Promise<FileServeResult | null>;
}

export const FILE_STORAGE_ADAPTER = Symbol('FILE_STORAGE_ADAPTER');
