import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { TaskController } from './task.controller';

describe('TaskController', () => {
  // A task is withdrawn through the case (`POST /api/cases/:id/cancel-assignment`,
  // `case:assign`), never deleted: the old delete routes checked no permission
  // or scope and left the case pointing at a tombstoned round.
  it('exposes no route that deletes a task', () => {
    const routes = Object.getOwnPropertyNames(TaskController.prototype)
      .filter((name) => name !== 'constructor')
      .map((name) => {
        const handler = Object.getOwnPropertyDescriptor(TaskController.prototype, name)?.value as
          | (() => unknown)
          | undefined;
        return {
          name,
          method: handler ? (Reflect.getMetadata(METHOD_METADATA, handler) as unknown) : undefined,
          path: handler ? (Reflect.getMetadata(PATH_METADATA, handler) as unknown) : undefined,
        };
      });

    expect(routes.map((route) => route.name)).not.toContain('deleteTask');
    expect(routes.filter((route) => route.method === RequestMethod.DELETE)).toEqual([]);
    expect(
      routes.filter((route) => typeof route.path === 'string' && /delete/i.test(route.path)),
    ).toEqual([]);
  });
});
