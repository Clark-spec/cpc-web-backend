import { eq, and, desc } from "drizzle-orm";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { randomUUID } from "node:crypto";

export type NotificationItem = {
  id: string;
  userId: string;
  message: string;
  type: "info" | "success" | "warning";
  officeId?: string | null;
  href?: string | null;
  read: boolean;
  createdAt: string;
};

const now = Date.now();

// Fresh start: no demo notifications
const memNotifications: NotificationItem[] = [];

export class NotificationRepository {
  async findByUserId(userId: string) {
    try {
      const rows = await db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, userId))
        .orderBy(desc(notifications.createdAt));
      if (rows && rows.length > 0) {
        const unread = rows.filter((r) => !r.read).length;
        return { notifications: rows, unread };
      }
    } catch {
      // Fall through to memory
    }

    const userNotifs = memNotifications
      .filter((n) => n.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const unread = userNotifs.filter((n) => !n.read).length;
    return { notifications: userNotifs, unread };
  }

  async markAsRead(userId: string, id: string) {
    try {
      await db
        .update(notifications)
        .set({ read: true })
        .where(and(eq(notifications.userId, userId), eq(notifications.id, id)));
    } catch {
      // Fall through to memory
    }

    const item = memNotifications.find((n) => n.userId === userId && n.id === id);
    if (item) {
      item.read = true;
    }
    return true;
  }

  async markAllAsRead(userId: string) {
    try {
      await db
        .update(notifications)
        .set({ read: true })
        .where(eq(notifications.userId, userId));
    } catch {
      // Fall through to memory
    }

    memNotifications.forEach((n) => {
      if (n.userId === userId) {
        n.read = true;
      }
    });
    return true;
  }

  async delete(userId: string, id: string) {
    try {
      await db
        .delete(notifications)
        .where(and(eq(notifications.userId, userId), eq(notifications.id, id)));
    } catch {
      // Fall through to memory
    }

    const index = memNotifications.findIndex((n) => n.userId === userId && n.id === id);
    if (index !== -1) {
      memNotifications.splice(index, 1);
    }
    return true;
  }

  async deleteAll(userId: string) {
    try {
      await db.delete(notifications).where(eq(notifications.userId, userId));
    } catch {
      // Fall through to memory
    }

    for (let i = memNotifications.length - 1; i >= 0; i--) {
      if (memNotifications[i].userId === userId) {
        memNotifications.splice(i, 1);
      }
    }
    return true;
  }

  async create(
    userId: string,
    data: { message: string; type?: "info" | "success" | "warning"; officeId?: string; href?: string }
  ) {
    const item: NotificationItem = {
      id: randomUUID(),
      userId,
      message: data.message,
      type: data.type ?? "info",
      officeId: data.officeId ?? null,
      href: data.href ?? null,
      read: false,
      createdAt: new Date().toISOString(),
    };

    try {
      const [inserted] = await db.insert(notifications).values(item).returning();
      if (inserted) {
        memNotifications.unshift(inserted as any);
        return inserted;
      }
    } catch {
      // Fall through to memory
    }

    memNotifications.unshift(item);
    return item;
  }
}

