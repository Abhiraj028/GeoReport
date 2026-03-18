import express, { Express } from "express";
import cors from "cors";
import reportsRoutes from "./routes/reports.routes";
import { errorMiddleware } from "./middlewares/errorMiddleware";

export const app : Express = express();

app.use(cors({origin: "*"}));
app.use(express.json());

app.use("/api/v1/reports", reportsRoutes );
app.use(errorMiddleware);

