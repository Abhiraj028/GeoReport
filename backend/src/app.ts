import express, { type Express } from "express";
import cors from "cors";
import { errorMiddleware } from "./middlewares/error.middleware.ts";
import reportsRouter from "./routes/reports.routes.ts";

export const app: Express = express();

// ── Middleware ───────────────────────────────────────────────
app.use(
  cors({
    origin:      process.env.CORS_ORIGIN ?? "http://localhost:5173",
    credentials: true, // required for httpOnly cookie transport
  })
);
app.use(express.json());

// ── Routes ───────────────────────────────────────────────────
app.use("/api/v1/reports", reportsRouter);

// ── Error handler (must be last) ────────────────────────────
app.use(errorMiddleware);
