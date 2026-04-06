import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

// Validate required env vars at startup — fail loudly, not at query time.
const required = [
  "POSTGRES_USER",
  "POSTGRES_HOST",
  "POSTGRES_DB",
  "POSTGRES_PASSWORD",
] as const;

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`[db] Missing required environment variable: ${key}`);
  }
}

export const pool = new Pool({
  user:     process.env.POSTGRES_USER,
  host:     process.env.POSTGRES_HOST,
  database: process.env.POSTGRES_DB,
  password: process.env.POSTGRES_PASSWORD,
  port:     parseInt(process.env.POSTGRES_PORT ?? "5432", 10),

  max:                    20,
  idleTimeoutMillis:      30_000,
  connectionTimeoutMillis: 2_000,
});

pool.on("error", (err) => {
  console.error("[db] Unexpected pool error:", err);
});

/**
 * Run multiple queries inside a single transaction.
 * The same PoolClient is passed to every fn call — never query via the pool
 * directly inside a transaction. Rolls back automatically on error.
 */
export async function withTransaction<T>(
  fn: (client: import("pg").PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
