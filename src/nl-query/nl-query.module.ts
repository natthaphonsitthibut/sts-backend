import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NlConversation } from './entities/nl-conversation.entity';
import { NlConversationTurn } from './entities/nl-conversation-turn.entity';
import { NlQueryLog } from './entities/nl-query-log.entity';
import { NlConversationService } from './nl-conversation.service';
import { NlQueryController } from './nl-query.controller';
import { NlQueryLogService } from './nl-query-log.service';
import { NlQueryService } from './nl-query.service';

@Module({
  imports: [TypeOrmModule.forFeature([NlQueryLog, NlConversation, NlConversationTurn])],
  controllers: [NlQueryController],
  providers: [NlQueryService, NlQueryLogService, NlConversationService],
})
export class NlQueryModule {}
