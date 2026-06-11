import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';

@Injectable()
export class PasswordService {
  private readonly saltRounds = 12;
  private readonly tempPasswordLength = 18;

  async hash(password: string): Promise<string> {
    return bcrypt.hash(password, this.saltRounds);
  }

  async compare(plainPassword: string, hashedPassword: string): Promise<boolean> {
    if (!hashedPassword) return false;

    return bcrypt.compare(plainPassword, hashedPassword);
  }

  private isPlainText(password: string): boolean {
    return !password.startsWith('$2b$') && !password.startsWith('$2a$');
  }

  needsHashing(password: string): boolean {
    return this.isPlainText(password);
  }

  generateTempPassword(): string {
    return randomBytes(32)
      .toString('base64url')
      .replace(/[^A-Za-z0-9]/g, '')
      .slice(0, this.tempPasswordLength);
  }
}
