import { eq } from "drizzle-orm";
import { db } from "@/db";
import { studentProfiles, users } from "@/db/schema";
import { randomUUID } from "node:crypto";
import { UserRepository } from "@/repositories/user-repository";

const memProfiles = new Map<string, any>();

export class StudentProfileRepository {
  async findByUserId(userId: string) {
    try {
      const [profile] = await db
        .select()
        .from(studentProfiles)
        .where(eq(studentProfiles.userId, userId))
        .limit(1);
      if (profile) return profile;
    } catch {
      // Fall through to memory
    }

    return memProfiles.get(userId) ?? null;
  }

  async upsert(userId: string, data: Partial<typeof studentProfiles.$inferInsert>) {
    try {
      const existing = await this.findByUserId(userId);
      if (existing && existing.id) {
        const [updated] = await db
          .update(studentProfiles)
          .set({ ...data, updatedAt: new Date().toISOString() })
          .where(eq(studentProfiles.userId, userId))
          .returning();
        if (updated) return updated;
      } else {
        const [created] = await db
          .insert(studentProfiles)
          .values({ ...data, userId })
          .returning();
        if (created) return created;
      }
    } catch {
      // Fall through to memory
    }

    const prev = memProfiles.get(userId) ?? { id: randomUUID(), userId };
    const next = { ...prev, ...data, updatedAt: new Date().toISOString() };
    memProfiles.set(userId, next);
    return next;
  }

  async createDefault(userId: string) {
    try {
      const [created] = await db
        .insert(studentProfiles)
        .values({ userId })
        .returning();
      if (created) return created;
    } catch {
      // Fall through to memory
    }

    const next = {
      id: randomUUID(),
      userId,
      updatedAt: new Date().toISOString(),
    };
    memProfiles.set(userId, next);
    return next;
  }

  async updateAvatarUrl(userId: string, avatarUrl: string) {
    const userRepo = new UserRepository();
    const result = await userRepo.updateAvatarUrl(userId, avatarUrl);
    return result ? { id: userId, avatarUrl } : null;
  }
}
