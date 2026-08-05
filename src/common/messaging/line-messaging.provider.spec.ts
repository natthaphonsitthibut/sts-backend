import { createHmac } from 'node:crypto';
import type { ConfigType } from '@nestjs/config';
import type { lineConfig } from '../../config/line.config';
import { LineMessagingProvider } from './line-messaging.provider';

type LineConfig = ConfigType<typeof lineConfig>;

const CONFIG: LineConfig = {
  enabled: true,
  loginChannelId: '2000000001',
  loginChannelSecret: 'login-secret',
  loginCallbackUrl: 'https://api.sts.test/api/line/link/callback',
  messagingChannelId: '2000000002',
  messagingChannelSecret: 'messaging-secret',
  messagingChannelAccessToken: 'channel-token',
  officialAccountBasicId: '@sts-school',
  requestTimeoutMs: 8000,
};

function createProvider(overrides: Partial<LineConfig> = {}) {
  return new LineMessagingProvider({ ...CONFIG, ...overrides });
}

describe('LineMessagingProvider', () => {
  it('stays off when switched on without the credentials it needs', () => {
    expect(createProvider().isEnabled()).toBe(true);
    expect(createProvider({ enabled: false }).isEnabled()).toBe(false);
    // A half-filled .env must not arm the feature — the teacher would otherwise
    // meet the failure mid-redirect.
    expect(createProvider({ messagingChannelAccessToken: '' }).isEnabled()).toBe(false);
    expect(createProvider({ loginChannelSecret: '  ' }).isEnabled()).toBe(false);
  });

  it('asks for the add-friend prompt and the openid scope', () => {
    const url = new URL(
      createProvider().buildAuthorizationUrl({
        state: 'state-value',
        nonce: 'nonce-value',
        promptAddFriend: true,
      }),
    );

    expect(url.origin + url.pathname).toBe('https://access.line.me/oauth2/v2.1/authorize');
    expect(url.searchParams.get('client_id')).toBe(CONFIG.loginChannelId);
    expect(url.searchParams.get('redirect_uri')).toBe(CONFIG.loginCallbackUrl);
    expect(url.searchParams.get('state')).toBe('state-value');
    expect(url.searchParams.get('nonce')).toBe('nonce-value');
    // Without openid there is no id_token, and the identity could only come from
    // an unverified profile call.
    expect(url.searchParams.get('scope')).toContain('openid');
    expect(url.searchParams.get('bot_prompt')).toBe('aggressive');
  });

  it('omits the add-friend prompt when it was not asked for', () => {
    const url = new URL(
      createProvider().buildAuthorizationUrl({
        state: 's',
        nonce: 'n',
        promptAddFriend: false,
      }),
    );
    expect(url.searchParams.has('bot_prompt')).toBe(false);
  });

  it('builds the add-contact link from the official account id', () => {
    expect(createProvider().buildAddContactUrl()).toBe('https://line.me/R/ti/p/@sts-school');
  });

  it('accepts only a signature made with the channel secret', () => {
    const provider = createProvider();
    const body = JSON.stringify({ events: [{ type: 'follow' }] });
    const signature = createHmac('sha256', CONFIG.messagingChannelSecret)
      .update(body)
      .digest('base64');

    expect(provider.verifyWebhookSignature(body, signature)).toBe(true);
    expect(provider.verifyWebhookSignature(body, '')).toBe(false);
    expect(
      provider.verifyWebhookSignature(
        body,
        createHmac('sha256', 'wrong-secret').update(body).digest('base64'),
      ),
    ).toBe(false);
    // A tampered body must fail even though the signature itself is well-formed.
    expect(provider.verifyWebhookSignature(`${body} `, signature)).toBe(false);
  });

  it('reports a delivery failure per recipient instead of throwing the batch away', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: true, status: 200 } as Response)
      .mockResolvedValueOnce({ ok: false, status: 400 } as Response);

    const results = await createProvider().sendMessages(
      [
        { providerUserId: 'U0000000000000000000000000000001', text: 'link one' },
        { providerUserId: 'U0000000000000000000000000000002', text: 'link two' },
      ],
      'batch-1',
    );

    expect(results[0]).toEqual({
      providerUserId: 'U0000000000000000000000000000001',
      delivered: true,
    });
    expect(results[1].delivered).toBe(false);
    expect(results[1].errorMessage).toContain('เพื่อน');

    // Each recipient gets its own retry key so a repeated batch cannot send the
    // same link twice to whoever already received it.
    const keys = fetchMock.mock.calls.map(
      ([, init]) => (init?.headers as Record<string, string>)['X-Line-Retry-Key'],
    );
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    fetchMock.mockRestore();
  });

  it('uses bounded concurrency for a large recipient batch', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      await gate;
      return { ok: true, status: 200 } as Response;
    });
    const messages = Array.from({ length: 12 }, (_, index) => ({
      providerUserId: `U${String(index).padStart(32, '0')}`,
      text: `link ${index}`,
    }));

    const pending = createProvider().sendMessages(messages, 'batch-concurrent');
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(10);

    release();
    await expect(pending).resolves.toHaveLength(12);
    expect(fetchMock).toHaveBeenCalledTimes(12);
    fetchMock.mockRestore();
  });

  it('reads a missing profile as "not a friend" rather than an outage', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: false, status: 404 } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200 } as Response)
      .mockResolvedValueOnce({ ok: false, status: 500 } as Response);

    const provider = createProvider();
    await expect(provider.readFriendState('U1')).resolves.toBe('NOT_FRIEND');
    await expect(provider.readFriendState('U1')).resolves.toBe('FRIEND');
    await expect(provider.readFriendState('U1')).resolves.toBe('UNKNOWN');
    fetchMock.mockRestore();
  });
});
