import type { Request, Response } from 'express';
import { NoStoreMiddleware } from './no-store.middleware';

describe('NoStoreMiddleware', () => {
  it('marks every response unstorable before the route decides anything', () => {
    const middleware = new NoStoreMiddleware();
    const setHeader = jest.fn();
    const next = jest.fn();

    middleware.use({} as Request, { setHeader } as unknown as Response, next);

    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(next).toHaveBeenCalledTimes(1);
  });
});
