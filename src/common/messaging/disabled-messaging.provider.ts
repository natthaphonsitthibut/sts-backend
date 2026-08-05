import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type {
  MessagingDeliveryResult,
  MessagingFriendState,
  MessagingOutboundMessage,
  MessagingProvider,
} from './messaging.types';

/**
 * Stands in whenever the integration is switched off or half-configured, so dev,
 * test and CI run with no credentials at all.
 *
 * It refuses loudly rather than pretending to succeed: a silent no-op would let
 * an operator believe links went out to teachers when nothing was sent. Callers
 * are expected to check `isEnabled()` and hide the feature instead of relying on
 * these throws.
 */
@Injectable()
export class DisabledMessagingProvider implements MessagingProvider {
  private readonly logger = new Logger(DisabledMessagingProvider.name);

  isEnabled(): boolean {
    return false;
  }

  buildAuthorizationUrl(): string {
    throw this.unavailable();
  }

  buildAddContactUrl(): string {
    throw this.unavailable();
  }

  completeAuthorization(): Promise<never> {
    throw this.unavailable();
  }

  readFriendState(): Promise<MessagingFriendState> {
    return Promise.resolve('UNKNOWN');
  }

  sendMessages(messages: readonly MessagingOutboundMessage[]): Promise<MessagingDeliveryResult[]> {
    this.logger.warn(
      `Messaging is disabled; ${messages.length} message(s) were not sent to any teacher.`,
    );
    return Promise.resolve(
      messages.map((message) => ({
        providerUserId: message.providerUserId,
        delivered: false,
        errorMessage: 'ระบบส่งข้อความยังไม่เปิดใช้งาน',
      })),
    );
  }

  verifyWebhookSignature(): boolean {
    return false;
  }

  private unavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException('ระบบเชื่อมบัญชี LINE ยังไม่เปิดใช้งาน');
  }
}
