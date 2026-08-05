import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FilesController } from './files.controller';

@Module({
  imports: [AuthModule],
  controllers: [FilesController],
})
export class FilesModule {}
