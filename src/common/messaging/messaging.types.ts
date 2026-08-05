/**
 * Provider-neutral contract for reaching a teacher on a chat platform.
 *
 * LINE is the only implementation today, but the flow the school actually cares
 * about — "prove who this person is, then send them their link" — is not
 * LINE-specific, and a national system should not have the vendor's name in its
 * service layer. Everything LINE-shaped stays behind this interface.
 */

/** Whether the person can currently be reached, i.e. still has the OA added. */
export type MessagingFriendState = 'FRIEND' | 'NOT_FRIEND' | 'BLOCKED' | 'UNKNOWN';

export interface MessagingIdentity {
  /** Provider-scoped account id. For LINE this is the userId (`U` + 32 hex). */
  providerUserId: string;
  displayName: string | null;
}

export interface MessagingAuthorizationRequest {
  /** Opaque CSRF value the caller stored; the provider echoes it back. */
  state: string;
  /** Replay guard bound into the identity token. */
  nonce: string;
  /** Ask the provider to offer "add friend" during sign-in when it can. */
  promptAddFriend: boolean;
}

export interface MessagingAuthorizationResult {
  identity: MessagingIdentity;
  friendState: MessagingFriendState;
}

export interface MessagingOutboundMessage {
  providerUserId: string;
  text: string;
}

export interface MessagingDeliveryResult {
  providerUserId: string;
  delivered: boolean;
  /** Present when `delivered` is false: why the provider refused. */
  errorMessage?: string;
}

export interface MessagingProvider {
  /** False when the integration is switched off or not fully configured. */
  isEnabled(): boolean;

  /** Where to send the browser to start sign-in. */
  buildAuthorizationUrl(request: MessagingAuthorizationRequest): string;

  /** Public link that adds the school's account as a contact. */
  buildAddContactUrl(): string;

  /**
   * Turns the code from the provider's redirect into a verified identity and a
   * fresh friendship reading. Throws when the code is invalid or the provider is
   * unreachable — the caller must not record a binding in that case.
   */
  completeAuthorization(code: string, expectedNonce: string): Promise<MessagingAuthorizationResult>;

  /** Re-reads the friendship state for an already-bound account. */
  readFriendState(providerUserId: string): Promise<MessagingFriendState>;

  /**
   * Sends one message per recipient and reports each outcome separately —
   * every teacher receives their OWN link, so there is no one broadcast body to
   * fan out, and "who did not get it" has to be answerable per person.
   * Never throws for a single bad recipient.
   *
   * `idempotencyKeyPrefix` is combined with the recipient id so a retried batch
   * cannot double-send to anyone who already received it.
   */
  sendMessages(
    messages: readonly MessagingOutboundMessage[],
    idempotencyKeyPrefix: string,
  ): Promise<MessagingDeliveryResult[]>;

  /** Verifies an inbound webhook came from the provider. */
  verifyWebhookSignature(rawBody: Buffer | string, signature: string): boolean;
}

export const MESSAGING_PROVIDER = Symbol('MESSAGING_PROVIDER');
