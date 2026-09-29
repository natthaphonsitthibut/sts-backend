import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { EventEmitter } from 'events';
import { Readable } from 'stream';
import type { Request, Response } from 'express';
import { TaskService } from './task.service';
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

  it.each(['getStudentPhoto', 'getAssigneePhoto'] as const)(
    '%s sends guarded photo bytes from this origin without redirecting',
    async (method) => {
      const stream = Readable.from(Buffer.from('image'));
      const service = {
        resolveStudentPhoto: jest.fn().mockResolvedValue({ stream, contentType: 'image/png' }),
        resolveAssigneePhoto: jest.fn().mockResolvedValue({ stream, contentType: 'image/png' }),
      };
      const setHeader = jest.fn();
      const redirect = jest.fn();
      const response = Object.assign(new EventEmitter(), {
        setHeader,
        redirect,
        destroy: jest.fn(),
      }) as unknown as Response;
      const pipe = jest.spyOn(stream, 'pipe').mockReturnValue(response);
      const controller = new TaskController(
        service as unknown as TaskService,
        {} as never,
        {} as never,
      );

      await controller[method](
        'link-token',
        { headers: { 'x-magic-session': 'verified-session' } } as unknown as Request,
        response,
      );

      expect(
        service[method === 'getStudentPhoto' ? 'resolveStudentPhoto' : 'resolveAssigneePhoto'],
      ).toHaveBeenCalledWith('link-token', 'verified-session');
      expect(setHeader).toHaveBeenCalledWith('Content-Type', 'image/png');
      expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
      expect(redirect).not.toHaveBeenCalled();
      expect(pipe).toHaveBeenCalledWith(response);
    },
  );
});
