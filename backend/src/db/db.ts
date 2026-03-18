import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

export const poolClient = new Pool({
    user: process.env.POSTGRES_USER,
    host: process.env.POSTGRES_HOST,
    database: process.env.POSTGRES_DB,
    password: process.env.POSTGRES_PASSWORD,
    
    port: parseInt(process.env.POSTGRES_PORT || "5432"),
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});