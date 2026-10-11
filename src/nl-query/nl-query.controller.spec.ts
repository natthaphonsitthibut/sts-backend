import { GUARDS_METADATA } from '@nestjs/common/constants';
import { PERMISSIONS_KEY } from '../auth/permissions.decorator';
import { AuthGuard, PermissionsGuard } from '../auth';
import type { AuthenticatedRequestUser } from '../auth';
import { NlQueryController } from './nl-query.controller';
import type { NlConversationService } from './nl-conversation.service';
import type { NlQueryService } from './nl-query.service';

describe('NlQueryController security metadata', () => {
  it('pairs permission metadata with both authentication and permission guards', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, NlQueryController) as unknown[];
    expect(guards).toEqual([AuthGuard, PermissionsGuard]);

    // Metadata is attached to the route handler function itself by SetMetadata.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(Reflect.getMetadata(PERMISSIONS_KEY, NlQueryController.prototype.ask)).toEqual([
      'nl_query:use',
    ]);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(Reflect.getMetadata(PERMISSIONS_KEY, NlQueryController.prototype.schema)).toEqual([
      'nl_query:use',
    ]);
  });
});

describe('NlQueryController conversation endpoints', () => {
  const user = { id: 7 } as AuthenticatedRequestUser;
  const id = '3f0c7a52-6a0e-4a3b-9d55-0f6f1b7a9c11';
  let conversations: {
    list: jest.Mock;
    get: jest.Mock;
    rename: jest.Mock;
    remove: jest.Mock;
  };
  let controller: NlQueryController;

  beforeEach(() => {
    conversations = {
      list: jest.fn().mockResolvedValue({ items: [], next_before: null }),
      get: jest.fn().mockResolvedValue({ id }),
      rename: jest.fn().mockResolvedValue({ id }),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    controller = new NlQueryController(
      {} as NlQueryService,
      conversations as unknown as NlConversationService,
    );
  });

  it.each([
    'listConversations',
    'getConversation',
    'renameConversation',
    'deleteConversation',
  ] as const)('%s requires nl_query:use', (handler) => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, NlQueryController.prototype[handler])).toEqual([
      'nl_query:use',
    ]);
  });

  it('lists with the caller id and a default page size of 30', async () => {
    await controller.listConversations(user, {});
    expect(conversations.list).toHaveBeenCalledWith(7, { limit: 30, before: undefined });

    await controller.listConversations(user, { limit: 10, before: '2026-10-02T00:00:00.000Z' });
    expect(conversations.list).toHaveBeenLastCalledWith(7, {
      limit: 10,
      before: '2026-10-02T00:00:00.000Z',
    });
  });

  it('scopes get / rename / delete to the authenticated user', async () => {
    await controller.getConversation(user, id);
    expect(conversations.get).toHaveBeenCalledWith(7, id);

    await controller.renameConversation(user, id, { title: 'ชื่อใหม่' });
    expect(conversations.rename).toHaveBeenCalledWith(7, id, 'ชื่อใหม่');

    await expect(controller.deleteConversation(user, id)).resolves.toBeUndefined();
    expect(conversations.remove).toHaveBeenCalledWith(7, id);
  });
});
