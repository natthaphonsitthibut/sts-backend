import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { getLineConfigFromEnv, missingLineConfigKeys } from '../../config/line.config';
import type { LineRuntimeConfig } from '../../config/line.config';
import { DisabledMessagingProvider } from './disabled-messaging.provider';
import { LineMessagingProvider } from './line-messaging.provider';
import { MESSAGING_PROVIDER } from './messaging.types';

/**
 * Picks the messaging implementation once, at boot, from configuration —
 * so no feature has to branch on "is LINE on?" at every call site, and a
 * deployment without credentials simply gets the disabled provider.
 */
@Module({
  imports: [ConfigModule],
  providers: [
    LineMessagingProvider,
    DisabledMessagingProvider,
    {
      provide: MESSAGING_PROVIDER,
      inject: [ConfigService, LineMessagingProvider, DisabledMessagingProvider],
      useFactory: (
        configService: ConfigService,
        line: LineMessagingProvider,
        disabled: DisabledMessagingProvider,
      ) => {
        const config = configService.get<LineRuntimeConfig>('line') ?? getLineConfigFromEnv();
        const usable = config.enabled && missingLineConfigKeys(config).length === 0;
        return usable ? line : disabled;
      },
    },
  ],
  exports: [MESSAGING_PROVIDER],
})
export class MessagingModule {}
