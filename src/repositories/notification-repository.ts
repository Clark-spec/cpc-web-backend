import { eq, and, desc, count } from "drizzle-orm";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { randomUUID } from "node:crypto";

export type NotificationType = "info" | "success" | "warning";

export type NotificationItem = {
  id: string;
  userId: string;
  title?: string | null;
  message: string;
  type: NotificationType;
  officeId?: string | null;
  href?: string | null;
  read: boolean;
  readAt?: string | null;
  createdAt: string;
};

export type NotificationPage = {
  notifications: NotificationItem[];
  unread: number;
  total: number;
  hasMore: boolean;
};

// Fresh start: no demo notifications
const memNotifications: NotificationItem[] = [];

function toItem(row: Omit<NotificationItem, "type"> & { type: string }): NotificationItem {
  return { ...row, type: row.type as NotificationType };
}

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
        return { notifications: rows.map(toItem), unread };
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

  /**
   * One page of the bell feed plus the global unread/total counts. Counts are
   * computed over every row, not just this page, so the badge stays correct
   * while the list is paginated.
   */
  async findPageByUserId(
    userId: string,
    options: { limit: number; offset: number },
  ): Promise<NotificationPage> {
    const limit = Math.min(50, Math.max(1, options.limit));
    const offset = Math.max(0, options.offset);

    try {
      const [rows, [unreadRow], [totalRow]] = await Promise.all([
        db
          .select()
          .from(notifications)
          .where(eq(notifications.userId, userId))
          .orderBy(desc(notifications.createdAt))
          .limit(limit)
          .offset(offset),
        db
          .select({ value: count() })
          .from(notifications)
          .where(and(eq(notifications.userId, userId), eq(notifications.read, false))),
        db
          .select({ value: count() })
          .from(notifications)
          .where(eq(notifications.userId, userId)),
      ]);

      const total = Number(totalRow?.value ?? 0);
      return {
        notifications: rows.map(toItem),
        unread: Number(unreadRow?.value ?? 0),
        total,
        hasMore: offset + rows.length < total,
      };
    } catch {
      // Fall through to memory
    }

    const userNotifs = memNotifications
      .filter((n) => n.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return {
      notifications: userNotifs.slice(offset, offset + limit),
      unread: userNotifs.filter((n) => !n.read).length,
      total: userNotifs.length,
      hasMore: offset + limit < userNotifs.length,
    };
  }

  async markAsRead(userId: string, id: string) {
    const readAt = new Date().toISOString();
    try {
      await db
        .update(notifications)
        .set({ read: true, readAt })
        .where(and(eq(notifications.userId, userId), eq(notifications.id, id)));
    } catch {
      // Fall through to memory
    }

    const item = memNotifications.find((n) => n.userId === userId && n.id === id);
    if (item) {
      item.read = true;
      item.readAt = readAt;
    }
    return true;
  }

  async markAllAsRead(userId: string) {
    const readAt = new Date().toISOString();
    try {
      await db
        .update(notifications)
        .set({ read: true, readAt })
        .where(eq(notifications.userId, userId));
    } catch {
      // Fall through to memory
    }

    memNotifications.forEach((n) => {
      if (n.userId === userId) {
        n.read = true;
        n.readAt = readAt;
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
    data: {
      title?: string;
      message: string;
      type?: NotificationType;
      officeId?: string;
      href?: string;
    },
  ) {
    const item: NotificationItem = {
      id: randomUUID(),
      userId,
      title: data.title ?? null,
      message: data.message,
      type: data.type ?? "info",
      officeId: data.officeId ?? null,
      href: data.href ?? null,
      read: false,
      readAt: null,
      createdAt: new Date().toISOString(),
    };

    try {
      const [inserted] = await db.insert(notifications).values(item).returning();
      if (inserted) {
        memNotifications.unshift(toItem(inserted as Omit<NotificationItem, "type"> & { type: string }));
        return inserted;
      }
    } catch {
      // Fall through to memory
    }

    memNotifications.unshift(item);
    return item;
  }
}
