// Extends the Express Request interface with SlideTag-specific properties.
// This file is picked up globally via tsconfig include: ["src/**/*"].

import "express";

declare global {
  namespace Express {
    interface Request {
      /**
       * SHA-256 hash of the raw device token cookie.
       * Set by requireDevice (always defined on mutating routes).
       * Set by trackDevice (defined only if a valid known cookie was present).
       * Never the raw token — that lives only in the cookie and briefly in
       * middleware memory.
       */
      deviceToken?: string;
    }
  }
}
