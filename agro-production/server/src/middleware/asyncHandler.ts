import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Express 4 does not catch rejected promises from async handlers: a thrown
 * Prisma error becomes an unhandled rejection and the socket hangs until the
 * client times out (Issue #1207). Wrap every async route handler with this so
 * rejections are forwarded to `globalErrorHandler` as a problem+json 500.
 */
export function asyncHandler<Req extends Request = Request>(
  fn: (req: Req, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req as Req, res, next)).catch(next);
  };
}
