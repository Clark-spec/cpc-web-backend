import type { NextFunction, Request, Response } from "express";
import type { AuthenticatedRequest } from "@/middlewares/auth-middleware";

/**
 * Light in-memory rate limit for the complaint submit endpoint. The 72-hour
 * rule is the real control; this only blunts rapid retry loops.
 */
export class SubmitRateLimiter {
  private hits = new Map<string, number[]>();

  public execute = (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as AuthenticatedRequest).user?.sub;
    if (!userId) {
      return res.status(401).json({
        code: 401,
        status: "error",
        message: "Authentication required",
      });
    }

    const windowMs = 10 * 60 * 1000;
    const max = 10;
    const now = Date.now();
    const recent = (this.hits.get(userId) ?? []).filter(
      (time) => now - time < windowMs,
    );

    if (recent.length >= max) {
      const retryAt = new Date(recent[0] + windowMs).toISOString();
      return res.status(429).json({
        code: 429,
        status: "error",
        message: "Too many attempts. Please try again later.",
        data: { canSubmit: false, nextAllowedAt: retryAt },
      });
    }

    recent.push(now);
    this.hits.set(userId, recent);

    if (this.hits.size > 1000) {
      for (const [key, times] of this.hits) {
        if (times.every((time) => now - time >= windowMs)) this.hits.delete(key);
      }
    }

    return next();
  };
}
