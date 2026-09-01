import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NlQueryLog } from './entities/nl-query-log.entity';
import { NlQueryController } from './nl-query.controller';
import { NlQueryLogService } from './nl-query-log.service';
import { NlQueryService } from './nl-query.service';

@Module({
  imports: [TypeOrmModule.forFeature([NlQueryLog])],
  controllers: [NlQueryController],
  providers: [NlQueryService, NlQueryLogService],
})
export class NlQueryModule {}
