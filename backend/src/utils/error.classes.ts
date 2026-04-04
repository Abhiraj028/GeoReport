// Custom error hierarchy for SlideTag.
// All errors extend AppError so the error middleware can handle them uniformly.

export class AppError extends Error {
  readonly name:       string;
  readonly statusCode: number;

  constructor(name: string, statusCode: number, message: string) {
    super(message);
    this.name       = name;
    this.statusCode = statusCode;

    // Restores correct prototype chain when transpiled to ES5/CommonJS.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class BadRequestError extends AppError {
  constructor(message: string) {
    super("BadRequestError", 400, message);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super("NotFoundError", 404, message);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string) {
    super("UnauthorizedError", 401, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string) {
    super("ForbiddenError", 403, message);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super("ConflictError", 409, message);
  }
}

export class InternalServerError extends AppError {
  constructor(message: string) {
    super("InternalServerError", 500, message);
  }
}
