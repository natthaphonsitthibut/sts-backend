import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TaskModule } from '../task/task.module';
import { FilesController } from './files.controller';

@Module({
  imports: [AuthModule, TaskModule],
  controllers: [FilesController],
})
export class FilesModule {}
