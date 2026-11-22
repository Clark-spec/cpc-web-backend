import { eq, and, desc, count, inArray, gte } from "drizzle-orm";
import { db } from "@/db";
import { enrollmentSessions, notifications, users, officeNotifications, officeNotificationReads } from "@/db/schema";
import { randomUUID } from "node:crypto";

const clearanceLabels: Record<string, string> = {
  dean: "Dean",
  sao: "SAO / SSG Adviser",
  library: "Library",
  accounting: "Accounting",
  registrar: "Registrar",
};
const clearanceReconcileAt = new Map<string, number>();

async function reconcileClearanceNotifications(userId: string) {
  const now = Date.now();
  if (now - (clearanceReconcileAt.get(userId) ?? 0) < 15_000) return;
  clearanceReconcileAt.set(userId, now);
  try {
    const [recipient] = await db.select({ role: users.role, studentNumber: users.studentNumber })
      .from(users).where(eq(users.id, userId)).limit(1);
    const titles = Object.values(clearanceLabels).flatMap((label) => [
      `Clearance request: ${label}`,
      `Clearance pending: ${label}`,
      `Clearance signed: ${label}`,
      `Clearance rejected: ${label}`,
    ]);
    const owned = await db.select().from(notifications).where(and(
      eq(notifications.userId, userId),
      inArray(notifications.title, titles),
    ));
    const studentIds = recipient?.role === "STUDENT" && recipient.studentNumber
      ? [recipient.studentNumber]
      : [...new Set(owned.map((item) => item.message.match(/\((\d{8})\)/)?.[1]).filter((id): id is string => Boolean(id)))];
    if (!studentIds.length) return;
    const sessions = await db.select({ studentId: enrollmentSessions.studentId, session: enrollmentSessions.session })
      .from(enrollmentSessions).where(inArray(enrollmentSessions.studentId, studentIds));
    for (const row of sessions) {
      const session = row.session as Record<string, any>;
      const clearance = session.clearance as Record<string, any> | undefined;
      const offices = Array.isArray(clearance?.offices) ? clearance.offices as Record<string, any>[] : [];
      const studentName = String(clearance?.studentName ?? session.student?.name ?? "Student");
      for (const officeState of offices) {
        const officeId = String(officeState.office ?? "");
        const label = clearanceLabels[officeId];
        const requestedAt = officeState.requestedAt as string | undefined;
        const status = officeState.status === "requested" ? "pending" : officeState.status;
        if (!label || !requestedAt || !["pending", "signed", "rejected"].includes(status)) continue;
        const current = owned.filter((item) => {
          if (item.officeId !== officeId || Date.parse(item.createdAt) < Date.parse(requestedAt)) return false;
          if (recipient?.role === "STUDENT") return true;
          return item.message.includes(`(${row.studentId})`);
        });
        if (!current.length) continue;
        const title = `Clearance ${status}: ${label}`;
        const isStudent = recipient?.role === "STUDENT";
        const message = status === "pending"
          ? isStudent
            ? `Your ${label} clearance request was sent and is pending review.`
            : `${studentName} (${row.studentId}) has a pending clearance signature request.`
          : isStudent
            ? `Your ${label} clearance request was ${status}.`
            : `${studentName} (${row.studentId}) clearance request was ${status}.`;
        const type = status === "signed" ? "success" : status === "rejected" ? "warning" : "info";
        const canonical = current.find((item) => item.title?.startsWith("Clearance pending:")) ?? current[0];
        const contentChanged = canonical.title !== title || canonical.message !== message || canonical.type !== type;
        if (contentChanged) {
          await db.update(notifications).set({ title, message, type, read: false, readAt: null })
            .where(eq(notifications.id, canonical.id));
        }
        const duplicateIds = current.filter((item) => item.id !== canonical.id).map((item) => item.id);
        if (duplicateIds.length) await db.delete(notifications).where(inArray(notifications.id, duplicateIds));
      }
    }
  } catch (error) {
    clearanceReconcileAt.delete(userId);
    console.error("Could not reconcile clearance notifications", error);
  }
}

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
const memOfficeNotifications: Array<NotificationItem & { officeId: string }> = [];
const memOfficeReads = new Set<string>();

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
    officeIds: string[] = [],
  ): Promise<NotificationPage> {
    const limit = Math.min(50, Math.max(1, options.limit));
    const offset = Math.max(0, options.offset);

    try {
      await reconcileClearanceNotifications(userId);
      const [rows, [totalRow]] = await Promise.all([
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
          .where(eq(notifications.userId, userId)),
      ]);

      const officeRows = officeIds.length
        ? await db.select().from(officeNotifications).where(inArray(officeNotifications.officeId, officeIds)).orderBy(desc(officeNotifications.createdAt))
        : [];
      const officeReadRows = officeRows.length
        ? await db.select().from(officeNotificationReads).where(and(eq(officeNotificationReads.userId, userId), inArray(officeNotificationReads.notificationId, officeRows.map((row) => row.id))))
        : [];
      const readIds = new Set(officeReadRows.map((row) => row.notificationId));
      const staffItems: NotificationItem[] = officeRows.map((row) => ({
        id: row.id, userId, title: row.title, message: row.message,
        type: row.type as NotificationType, officeId: row.officeId, href: row.href,
        read: readIds.has(row.id), readAt: null, createdAt: row.createdAt,
      }));
      const localRows = memNotifications.filter((item) => item.userId === userId);
      const localStaffItems = memOfficeNotifications.filter((item) => officeIds.includes(item.officeId)).map((item) => ({
        ...item, read: memOfficeReads.has(`${userId}:${item.id}`),
      }));
      const merged = new Map<string, NotificationItem>();
      for (const item of [...localRows, ...localStaffItems, ...rows.map(toItem), ...staffItems]) merged.set(item.id, item);
      const allForUser = [...merged.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const total = allForUser.length;
      return {
        notifications: allForUser.slice(offset, offset + limit),
        unread: allForUser.filter((item) => !item.read).length,
        total: Math.max(Number(totalRow?.value ?? 0) + officeRows.length, allForUser.length),
        hasMore: offset + Math.min(limit, allForUser.length - offset) < Math.max(Number(totalRow?.value ?? 0) + officeRows.length, allForUser.length),
      };
    } catch {
      // Fall through to memory
    }

    const userNotifs = memNotifications
      .filter((n) => n.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const officeNotifs: NotificationItem[] = memOfficeNotifications
      .filter((item) => officeIds.includes(item.officeId))
      .map((item) => ({ ...item, read: memOfficeReads.has(`${userId}:${item.id}`) }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const combined = [...userNotifs, ...officeNotifs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return {
      notifications: combined.slice(offset, offset + limit),
      unread: combined.filter((n) => !n.read).length,
      total: combined.length,
      hasMore: offset + limit < combined.length,
    };
  }

  async markAsRead(userId: string, id: string, officeIds: string[] = []) {
    const readAt = new Date().toISOString();
    try {
      const [officeItem] = officeIds.length ? await db.select({ id: officeNotifications.id }).from(officeNotifications).where(and(eq(officeNotifications.id, id), inArray(officeNotifications.officeId, officeIds))).limit(1) : [];
      if (officeItem) {
        await db.insert(officeNotificationReads).values({ notificationId: id, userId, readAt }).onConflictDoNothing();
        memOfficeReads.add(`${userId}:${id}`);
        return true;
      }
    } catch {
      // May be an in-memory office notification.
    }
    if (memOfficeNotifications.some((item) => item.id === id && officeIds.includes(item.officeId))) {
      memOfficeReads.add(`${userId}:${id}`);
      return true;
    }
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

  async markAllAsRead(userId: string, officeIds: string[] = []) {
    const readAt = new Date().toISOString();
    try {
      await db
        .update(notifications)
        .set({ read: true, readAt })
        .where(eq(notifications.userId, userId));
      if (officeIds.length) {
        const officeRows = await db.select({ id: officeNotifications.id }).from(officeNotifications).where(inArray(officeNotifications.officeId, officeIds));
        if (officeRows.length) await db.insert(officeNotificationReads).values(officeRows.map((row) => ({ notificationId: row.id, userId, readAt }))).onConflictDoNothing();
      }
    } catch {
      // Fall through to memory
    }

    memNotifications.forEach((n) => {
      if (n.userId === userId) {
        n.read = true;
        n.readAt = readAt;
      }
    });
    memOfficeNotifications.forEach((n) => { if (officeIds.includes(n.officeId)) memOfficeReads.add(`${userId}:${n.id}`); });
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

  async createForOffices(officeIds: string[], data: { title: string; message: string; type?: NotificationType; href?: string }) {
    const normalized = [...new Set(officeIds)];
    const created: NotificationItem[] = [];
    for (const officeId of normalized) {
      const title = data.title;
      const existsInMemory = memOfficeNotifications.some(
        (item) => item.officeId === officeId && item.title === title && item.message === data.message,
      );
      if (existsInMemory) continue;
      try {
        const [existing] = await db
          .select({ id: officeNotifications.id })
          .from(officeNotifications)
          .where(and(
            eq(officeNotifications.officeId, officeId),
            eq(officeNotifications.title, title),
            eq(officeNotifications.message, data.message),
          ))
          .limit(1);
        if (existing) continue;
        const [row] = await db.insert(officeNotifications).values({ officeId, ...data }).returning();
        if (row) {
          created.push({ id: row.id, userId: "", title: row.title, message: row.message, type: row.type as NotificationType, officeId, href: row.href, read: false, readAt: null, createdAt: row.createdAt });
          continue;
        }
      } catch {
        // Keep the in-memory fallback usable when the database is unavailable.
      }
      const item: NotificationItem & { officeId: string } = {
        id: randomUUID(), userId: "", officeId, title: data.title ?? null,
        message: data.message, type: data.type ?? "info", href: data.href ?? null,
        read: false, readAt: null, createdAt: new Date().toISOString(),
      };
      memOfficeNotifications.unshift(item);
      created.push(item);
    }
    return created;
  }
}
