class AppError extends Error {
    name: string;
    statusCode: number;

    constructor(name: string, statusCode: number, message: string){
        super(message);
        this.name = name;
        this.statusCode = statusCode;
    }
}

export class BadRequestError extends AppError {
    constructor(message: string){
        super("BadRequestError", 400, message);
    }
}

export class NotFoundError extends AppError {
    constructor(message: string){
        super("NotFoundError", 404, message);
    }
}

export class UnAuthorizedError extends AppError {
    constructor(message: string){
        super("UnAuthorizedError", 401, message);
    }
}

export class InternalServerError extends AppError {
    constructor(message: string){
        super("InternalServerError", 500, message);
    }
}

export class ConflictError extends AppError {
    constructor(message: string){
        super("ConflictError", 409, message);
    }
}

export class ForbiddenError extends AppError {
    constructor(message: string){
        super("ForbiddenError", 403, message);
    }
}

export default AppError;