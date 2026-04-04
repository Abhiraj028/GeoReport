import type { NextFunction, Request, Response } from "express";
import { AppError } from "../utils/error.classes.ts";

export const errorMiddleware = (
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  if (err instanceof AppError) {
    console.error(`[${err.name}] ${err.message}`);
    res.status(err.statusCode).json({
      error:   err.name,
      message: err.message,
    });
    return;
  }

  // Unknown / unhandled error — log full detail, expose nothing.
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[UnhandledError] ${message}`, err);
  res.status(500).json({
    error:   "InternalServerError",
    message: "An unexpected error occurred.",
  });
};
