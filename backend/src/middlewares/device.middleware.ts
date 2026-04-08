import { randomBytes, createHash } from "crypto";
import type { Request, Response, NextFunction } from "express";
import { pool } from "../db/db.ts";

// ── Internal helpers ─────────────────────────────────────────

function sha256hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Reads a single named cookie from the raw Cookie header.
 * Avoids the cookie-parser dependency for a single, simple, no-encoding value.
 */
function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const chunk of header.split(";")) {
    const eqIdx = chunk.indexOf("=");
    if (eqIdx === -1) continue;
    const key = chunk.slice(0, eqIdx).trim();
    if (key === name) return chunk.slice(eqIdx + 1).trim();
  }
  return undefined;
}

const COOKIE_NAME = "device_token";

/** Cookie attributes applied to every Set-Cookie response. */
const cookieOpts = {
  httpOnly: true,
  secure:   process.env.NODE_ENV === "production",
  sameSite: (process.env.NODE_ENV === "production" ? "strict" : "lax") as
    | "strict"
    | "lax",
  // 1 year — device identity must survive browser restarts.
  // Cookie loss = new anonymous identity (V1 design decision, M3).
  maxAge: 365 * 24 * 60 * 60 * 1000,
  encode: String,
};

// ── requireDevice ────────────────────────────────────────────

/**
 * Applied to all mutating routes: POST /reports, POST /media/*
 *
 * Guarantees req.deviceToken (the SHA-256 hash) is set before the next
 * handler runs. Creates a new anonymous user row when needed.
 *
 * Flow:
 *   cookie present → sha256 → lookup users by device_token_hash
 *     found     → bump last_seen_at, attach hash, next()
 *     not found → stale/forged cookie, fall through and mint new identity
 *   cookie missing (or stale/forged) →
 *     randomBytes(32) → sha256 → INSERT users → set cookie → attach hash, next()
 *
 * DB failure → next(err). Never silently swallow and proceed unauthenticated.
 */
export const requireDevice = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const rawToken = readCookie(req, COOKIE_NAME);

    if (rawToken !== undefined) {
      const hash = sha256hex(rawToken);

      // UPDATE doubles as an existence check — rowCount > 0 means the token is known.
      const { rowCount } = await pool.query(
        `UPDATE users
            SET last_seen_at = now()
          WHERE device_token_hash = $1
          RETURNING id`,
        [hash]
      );

      if (rowCount && rowCount > 0) {
        req.deviceToken = hash;
        next();
        return;
      }
      // rowCount === 0: token not in DB (stale cookie or forged).
      // Fall through to mint a fresh identity below.
    }

    // ── Mint a new anonymous identity ────────────────────────
    const raw  = randomBytes(32).toString("hex"); // 64-char hex, 256 bits of entropy
    const hash = sha256hex(raw);

    // user_trust 0.3: slightly cautious prior for a brand-new anonymous device.
    // (Schema column default is 0.5 for non-anonymous paths; 0.3 here is intentional.)
    await pool.query(
      `INSERT INTO users (device_token_hash, user_trust, last_seen_at)
       VALUES ($1, $2, now())`,
      [hash, 0.3]
    );

    res.cookie(COOKIE_NAME, raw, cookieOpts);
    req.deviceToken = hash;
    next();
  } catch (err) {
    // DB failure: propagate to error middleware → 500. Do not proceed.
    next(err);
  }
};

// ── trackDevice ──────────────────────────────────────────────

/**
 * Applied to GET /:id only.
 *
 * Optional identity resolution — never creates a user row.
 * req.deviceToken is set only if a valid known cookie is present.
 *
 * The last_seen_at UPDATE is awaited for the existence check, but its
 * result is non-critical: a DB error here is logged and swallowed
 * so the public read request is never blocked by an analytics write.
 */
export const trackDevice = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  const rawToken = readCookie(req, COOKIE_NAME);

  if (!rawToken) {
    // No cookie → fully anonymous, proceed immediately.
    next();
    return;
  }

  const hash = sha256hex(rawToken);

  try {
    const { rowCount } = await pool.query(
      `UPDATE users
          SET last_seen_at = now()
        WHERE device_token_hash = $1
        RETURNING id`,
      [hash]
    );

    if (rowCount && rowCount > 0) {
      // Known device — attach hash so downstream can use it (e.g. ownership UI).
      req.deviceToken = hash;
    }
    // rowCount === 0: stale/forged cookie. Proceed anonymously, no row created.
  } catch (err) {
    // trackDevice is best-effort analytics. Log the failure, don't block the read.
    console.error("[trackDevice] last_seen_at update failed:", err);
  }

  next();
};
