import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Wraps an async Express handler so that any thrown error or rejected promise
 * is forwarded to Express's error middleware via next(err).
 *
 * Usage:
 *   router.post("/", catchAsync(myController));
 */
export const catchAsync =
  (fn: RequestHandler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
