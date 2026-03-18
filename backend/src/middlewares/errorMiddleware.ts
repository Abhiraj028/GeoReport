import AppError from "../utils/errorClass"
import { NextFunction, Request, Response } from "express";

export const errorMiddleware = (err: Error, req: Request, res: Response, next: NextFunction) => {
    if( err instanceof AppError ){
        console.error(`Error: ${err.name}, Message: ${err.message}, Stack: ${err.stack}`);
        return res.status(err.statusCode).json({ error: err.name, message: err.message });
    }
    console.error(`Unexpected Error: ${err.message}, Stack: ${err.stack}`);
    return res.status(500).json({ error: "InternalServerError", message: "An unexpected error occurred." });
}