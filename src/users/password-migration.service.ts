import { Injectable, Logger } from '@nestjs/common';
import { PasswordService } from '../auth/password.service';
import { UsersRepository } from './users.repository';

@Injectable()
export class PasswordMigrationService {
  private readonly logger = new Logger(PasswordMigrationService.name);

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly passwordService: PasswordService,
  ) {}

  async hashExistingPasswords() {
    this.logger.log('Starting to hash existing plaintext passwords...');

    const users = await this.usersRepository.listPlaintextPasswordUsers();
    let updated = 0;

    for (const user of users) {
      const hashedPassword = await this.passwordService.hash(user.password);
      await this.usersRepository.updatePasswordHash(user.id, hashedPassword);
      updated += 1;
    }

    this.logger.log(`Hashed ${updated} passwords`);
    return { updated };
  }
}
