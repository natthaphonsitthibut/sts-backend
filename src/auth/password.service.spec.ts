import { randomUUID } from 'crypto';
import { PasswordService } from './password.service';

describe('PasswordService', () => {
  let service: PasswordService;

  beforeEach(() => {
    service = new PasswordService();
  });

  it('hashes and verifies a valid password with bcrypt', async () => {
    const password = randomUUID();
    const hash = await service.hash(password);

    expect(hash).toMatch(/^\$2[ab]\$/);
    await expect(service.compare(password, hash)).resolves.toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await service.hash(randomUUID());

    await expect(service.compare(randomUUID(), hash)).resolves.toBe(false);
  });

  it('does not accept plaintext stored passwords as a fallback', async () => {
    const plaintextStoredPassword = randomUUID();

    await expect(service.compare(plaintextStoredPassword, plaintextStoredPassword)).resolves.toBe(
      false,
    );
    expect(service.needsHashing(plaintextStoredPassword)).toBe(true);
  });
});
