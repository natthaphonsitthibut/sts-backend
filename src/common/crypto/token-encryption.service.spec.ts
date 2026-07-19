import { TokenEncryptionService } from './token-encryption.service';

function buildService(keyHex: string): TokenEncryptionService {
  return new TokenEncryptionService({ taskLinkKey: Buffer.from(keyHex, 'hex') });
}

const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);

describe('TokenEncryptionService', () => {
  it('round-trips a token through encrypt/decrypt', () => {
    const service = buildService(KEY_A);
    const token = 'a'.repeat(64);

    const encrypted = service.encrypt(token);
    expect(encrypted).not.toContain(token);
    expect(service.decrypt(encrypted)).toBe(token);
  });

  it('produces different ciphertext for the same input each time (random IV)', () => {
    const service = buildService(KEY_A);
    const token = 'same-token-value';

    expect(service.encrypt(token)).not.toBe(service.encrypt(token));
  });

  it('fails to decrypt with the wrong key', () => {
    const encrypted = buildService(KEY_A).encrypt('a-secret-token');

    expect(() => buildService(KEY_B).decrypt(encrypted)).toThrow();
  });

  it('fails to decrypt tampered ciphertext (auth tag mismatch)', () => {
    const service = buildService(KEY_A);
    const encrypted = service.encrypt('a-secret-token');
    const [version, iv, tag, ciphertext] = encrypted.split(':');
    const tamperedCiphertext = `${ciphertext[0] === '0' ? '1' : '0'}${ciphertext.slice(1)}`;
    const tampered = [version, iv, tag, tamperedCiphertext].join(':');

    expect(() => service.decrypt(tampered)).toThrow();
  });

  it('rejects an unrecognized ciphertext format', () => {
    const service = buildService(KEY_A);

    expect(() => service.decrypt('not-a-valid-payload')).toThrow(/format/);
  });
});
