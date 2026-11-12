import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { tokens } from "@/db/schema";
import { randomUUID } from "node:crypto";

type CreateTokenData = {
  userId: string;
  token: string;
  expiresAt: Date;
};

type MemToken = {
  id: string;
  userId: string;
  token: string;
  expiresAt: string;
  type: string;
  consumedAt?: string | null;
  revokedAt?: string | null;
};

const memTokens = new Map<string, MemToken>();

export class TokenRepository {
  // Store the token so the API can track its expiration and usage.
  async createRefreshToken(data: CreateTokenData) {
    const expiresAt = data.expiresAt.toISOString();

    try {
      const [token] = await db
        .insert(tokens)
        .values({
          userId: data.userId,
          token: data.token,
          expiresAt: expiresAt,
          type: "REFRESH",
        })
        .returning();

      return token;
    } catch {
      // Fallback to in-memory store if DB is unreachable
      const id = randomUUID();
      const mem: MemToken = {
        id,
        userId: data.userId,
        token: data.token,
        expiresAt,
        type: "REFRESH",
        consumedAt: null,
        revokedAt: null,
      };
      memTokens.set(data.token, mem);
      return mem as any;
    }
  }

  // Only return a token that is unused, unrevoked, and not expired.
  async findActiveRefreshToken(token: string) {
    const currentTime = new Date().toISOString();

    try {
      const [activeToken] = await db
        .select()
        .from(tokens)
        .where(
          and(
            eq(tokens.token, token),
            eq(tokens.type, "REFRESH"),
            isNull(tokens.consumedAt),
            isNull(tokens.revokedAt),
            gt(tokens.expiresAt, currentTime),
          ),
        )
        .limit(1);

      if (activeToken) return activeToken;
    } catch {
      // Fall through to memory
    }

    const mem = memTokens.get(token);
    if (
      mem &&
      mem.type === "REFRESH" &&
      !mem.consumedAt &&
      !mem.revokedAt &&
      mem.expiresAt > currentTime
    ) {
      return mem as any;
    }

    return null;
  }

  // Mark the old refresh token as used when the API rotates tokens.
  async consumeToken(id: string) {
    const consumedAt = new Date().toISOString();

    try {
      const [token] = await db
        .update(tokens)
        .set({
          consumedAt: consumedAt,
        })
        .where(
          and(
            eq(tokens.id, id),
            isNull(tokens.consumedAt),
            isNull(tokens.revokedAt),
          ),
        )
        .returning();

      if (token) return token;
    } catch {
      // Fall through to memory
    }

    for (const mem of memTokens.values()) {
      if (mem.id === id && !mem.consumedAt && !mem.revokedAt) {
        mem.consumedAt = consumedAt;
        return mem as any;
      }
    }

    return null;
  }

  // Logout revokes the token so it cannot be used to refresh again.
  async revokeToken(id: string) {
    const revokedAt = new Date().toISOString();

    try {
      const [token] = await db
        .update(tokens)
        .set({
          revokedAt: revokedAt,
        })
        .where(eq(tokens.id, id))
        .returning();

      if (token) return token;
    } catch {
      // Fall through to memory
    }

    for (const mem of memTokens.values()) {
      if (mem.id === id) {
        mem.revokedAt = revokedAt;
        return mem as any;
      }
    }

    return null;
  }
}
