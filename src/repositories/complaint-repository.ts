import { and, count, desc, eq, gte, ilike, lt, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { randomUUID } from "node:crypto";
import { db } from "@/db";
import { complaintSubmitters, complaints, users } from "@/db/schema";
import { UserRepository } from "@/repositories/user-repository";

export const COMPLAINT_COOLDOWN_MS = 72 * 60 * 60 * 1000;

export type ComplaintAttachmentInput = {
  name: string;
  type: string;
  size: number;
  /** Base64 data URL. */
  data: string;
};

export type NewComplaintInput = {
  subject: string;
  category: string;
  description: string;
  isAnonymous: boolean;
  attachment?: ComplaintAttachmentInput | null;
  attachments?: ComplaintAttachmentInput[];
};

export type ComplaintFilters = {
  page: number;
  pageSize: number;
  search?: string;
  status?: string;
  category?: string;
  from?: string;
  to?: string;
};

export type ComplaintCreateResult =
  | { kind: "created"; complaint: any }
  | { kind: "cooldown"; nextAllowedAt: string };

export type ComplaintUpdateInput = {
  status?: string;
  adminRemarks?: string;
  expectedUpdatedAt?: string;
};

export type ComplaintUpdateResult =
  | { kind: "updated"; complaint: any }
  | { kind: "not_found" }
  | { kind: "conflict"; complaint: any };

// ─── In-memory fallback (used when Postgres is unavailable) ──────────────────

type MemComplaint = {
  id: string;
  referenceNumber: string;
  subject: string;
  category: string;
  description: string;
  attachmentName: string | null;
  attachmentType: string | null;
  attachmentSize: number | null;
  attachmentData: string | null;
  additionalAttachments: ComplaintAttachmentInput[];
  status: string;
  adminRemarks: string;
  isAnonymous: boolean;
  lastUpdatedById: string | null;
  lastUpdatedByRole: string | null;
  lastUpdatedByName: string | null;
  createdAt: string;
  updatedAt: string;
  submitterId: string;
  // Identity snapshot, only present for non-anonymous admin reads.
  studentName: string | null;
  studentId: string | null;
  program: string | null;
  yearLevel: number | null;
  email: string | null;
};

const memComplaints: MemComplaint[] = [];

function nextReference(now: Date) {
  const year = now.getUTCFullYear();
  const prefix = `CMP-${year}-`;
  const highest = memComplaints.reduce((max, item) => {
    if (!item.referenceNumber.startsWith(prefix)) return max;
    const n = Number(item.referenceNumber.slice(prefix.length));
    return Number.isFinite(n) ? Math.max(max, n) : max;
  }, 0);
  return `${prefix}${String(highest + 1).padStart(4, "0")}`;
}

function matchesFilters(item: MemComplaint, filters: ComplaintFilters) {
  const query = (filters.search ?? "").trim().toLowerCase();
  if (query) {
    const haystack = [item.referenceNumber, item.subject, item.category]
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(query)) return false;
  }
  if (filters.status && item.status !== filters.status) return false;
  if (filters.category && item.category !== filters.category) return false;
  const created = item.createdAt.slice(0, 10);
  if (filters.from && created < filters.from) return false;
  if (filters.to && created > filters.to) return false;
  return true;
}

export class ComplaintRepository {
  // ── Student reads ──────────────────────────────────────────────────────────

  async findByUserId(userId: string) {
    try {
      const rows = await db
        .select({
          id: complaints.id,
          referenceNumber: complaints.referenceNumber,
          subject: complaints.subject,
          category: complaints.category,
          description: complaints.description,
          attachmentName: complaints.attachmentName,
          attachmentType: complaints.attachmentType,
          attachmentSize: complaints.attachmentSize,
          attachmentData: complaints.attachmentData,
          additionalAttachments: complaints.additionalAttachments,
          status: complaints.status,
          adminRemarks: complaints.adminRemarks,
          isAnonymous: complaints.isAnonymous,
          createdAt: complaints.createdAt,
          updatedAt: complaints.updatedAt,
        })
        .from(complaints)
        .innerJoin(
          complaintSubmitters,
          eq(complaintSubmitters.complaintId, complaints.id),
        )
        .where(eq(complaintSubmitters.userId, userId))
        .orderBy(desc(complaints.createdAt));
      return rows;
    } catch {
      return memComplaints
        .filter((item) => item.submitterId === userId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
  }

  async findOwnedById(id: string, userId: string) {
    try {
      const [row] = await db
        .select({
          id: complaints.id,
          referenceNumber: complaints.referenceNumber,
          subject: complaints.subject,
          category: complaints.category,
          description: complaints.description,
          attachmentName: complaints.attachmentName,
          attachmentType: complaints.attachmentType,
          attachmentSize: complaints.attachmentSize,
          attachmentData: complaints.attachmentData,
          additionalAttachments: complaints.additionalAttachments,
          status: complaints.status,
          adminRemarks: complaints.adminRemarks,
          isAnonymous: complaints.isAnonymous,
          createdAt: complaints.createdAt,
          updatedAt: complaints.updatedAt,
        })
        .from(complaints)
        .innerJoin(
          complaintSubmitters,
          eq(complaintSubmitters.complaintId, complaints.id),
        )
        .where(and(eq(complaints.id, id), eq(complaintSubmitters.userId, userId)))
        .limit(1);
      return row ?? null;
    } catch {
      return (
        memComplaints.find(
          (item) => item.id === id && item.submitterId === userId,
        ) ?? null
      );
    }
  }

  async getLastSubmittedAt(userId: string): Promise<string | null> {
    try {
      const [row] = await db
        .select({ createdAt: complaints.createdAt })
        .from(complaintSubmitters)
        .innerJoin(
          complaints,
          eq(complaints.id, complaintSubmitters.complaintId),
        )
        .where(eq(complaintSubmitters.userId, userId))
        .orderBy(desc(complaints.createdAt))
        .limit(1);
      return row?.createdAt ?? null;
    } catch {
      const latest = memComplaints
        .filter((item) => item.submitterId === userId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      return latest?.createdAt ?? null;
    }
  }

  // ── Student write ──────────────────────────────────────────────────────────

  async create(userId: string, input: NewComplaintInput): Promise<ComplaintCreateResult> {
    const now = new Date(Date.now());

    try {
      return await db.transaction(async (tx) => {
        // Serialise reference generation and the per-student cooldown check so
        // double-clicks or parallel requests cannot both pass the window.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('complaints:reference'))`);
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`complaints:user:${userId}`}))`);

        const [last] = await tx
          .select({ createdAt: complaints.createdAt })
          .from(complaintSubmitters)
          .innerJoin(
            complaints,
            eq(complaints.id, complaintSubmitters.complaintId),
          )
          .where(eq(complaintSubmitters.userId, userId))
          .orderBy(desc(complaints.createdAt))
          .limit(1);

        if (last) {
          const nextAllowed = new Date(
            new Date(last.createdAt).getTime() + COMPLAINT_COOLDOWN_MS,
          );
          if (nextAllowed.getTime() > now.getTime()) {
            return { kind: "cooldown", nextAllowedAt: nextAllowed.toISOString() };
          }
        }

        const year = now.getUTCFullYear();
        const yearStart = new Date(Date.UTC(year, 0, 1));
        const [total] = await tx
          .select({ value: count() })
          .from(complaints)
          .where(gte(complaints.createdAt, yearStart.toISOString()));
        const referenceNumber = `CMP-${year}-${String(Number(total?.value ?? 0) + 1).padStart(4, "0")}`;

        const [created] = await tx
          .insert(complaints)
          .values({
            referenceNumber,
            subject: input.subject,
            category: input.category,
            description: input.description,
            attachmentName: input.attachment?.name ?? null,
            attachmentType: input.attachment?.type ?? null,
            attachmentSize: input.attachment?.size ?? null,
            attachmentData: input.attachment?.data ?? null,
            additionalAttachments: input.attachments ?? [],
            isAnonymous: input.isAnonymous,
          })
          .returning();

        await tx
          .insert(complaintSubmitters)
          .values({ complaintId: created.id, userId });

        return { kind: "created", complaint: created };
      });
    } catch {
      // Fall through to the in-memory store when Postgres is unreachable.
    }

    // Resolve identity before the sync check-and-insert so two concurrent
    // requests cannot both observe an empty store.
    const submitter = await new UserRepository().findById(userId);

    const latest = memComplaints
      .filter((item) => item.submitterId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

    if (latest) {
      const nextAllowed = new Date(
        new Date(latest.createdAt).getTime() + COMPLAINT_COOLDOWN_MS,
      );
      if (nextAllowed.getTime() > now.getTime()) {
        return { kind: "cooldown", nextAllowedAt: nextAllowed.toISOString() };
      }
    }

    const timestamp = now.toISOString();
    const created: MemComplaint = {
      id: randomUUID(),
      referenceNumber: nextReference(now),
      subject: input.subject,
      category: input.category,
      description: input.description,
      attachmentName: input.attachment?.name ?? null,
      attachmentType: input.attachment?.type ?? null,
      attachmentSize: input.attachment?.size ?? null,
      attachmentData: input.attachment?.data ?? null,
      additionalAttachments: input.attachments ?? [],
      status: "pending",
      adminRemarks: "",
      isAnonymous: input.isAnonymous,
      lastUpdatedById: null,
      lastUpdatedByRole: null,
      lastUpdatedByName: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      submitterId: userId,
      studentName: input.isAnonymous ? null : (submitter?.name ?? null),
      studentId: input.isAnonymous ? null : (submitter?.studentNumber ?? null),
      program: input.isAnonymous ? null : (submitter?.course ?? null),
      yearLevel: input.isAnonymous ? null : (submitter?.yearLevel ?? null),
      email: input.isAnonymous ? null : (submitter?.email ?? null),
    };
    memComplaints.push(created);
    return { kind: "created", complaint: created };
  }

  // ── Admin reads ────────────────────────────────────────────────────────────

  private adminQuery(filters: ComplaintFilters) {
    const student = alias(users, "complaint_student");
    const admin = alias(users, "complaint_admin");

    const conditions = [
      filters.status ? eq(complaints.status, filters.status) : undefined,
      filters.category ? eq(complaints.category, filters.category) : undefined,
      filters.from
        ? gte(complaints.createdAt, new Date(`${filters.from}T00:00:00.000Z`).toISOString())
        : undefined,
      filters.to
        ? lt(
            complaints.createdAt,
            new Date(
              new Date(`${filters.to}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000,
            ).toISOString(),
          )
        : undefined,
    ];

    const query = (filters.search ?? "").trim();
    if (query) {
      const like = `%${query}%`;
      conditions.push(
        or(
          ilike(complaints.referenceNumber, like),
          ilike(complaints.subject, like),
          ilike(complaints.category, like),
          // Identity search only applies to non-anonymous rows.
          and(
            eq(complaints.isAnonymous, false),
            or(ilike(student.name, like), ilike(student.studentNumber, like)),
          ),
        ),
      );
    }

    const where = conditions.filter(Boolean);
    return {
      student,
      admin,
      where: where.length > 0 ? and(...(where as any[])) : undefined,
    };
  }

  private adminSelect(includeAttachmentData: boolean) {
    return {
      id: complaints.id,
      referenceNumber: complaints.referenceNumber,
      subject: complaints.subject,
      category: complaints.category,
      description: complaints.description,
      attachmentName: complaints.attachmentName,
      attachmentType: complaints.attachmentType,
      attachmentSize: complaints.attachmentSize,
      ...(includeAttachmentData ? { additionalAttachments: complaints.additionalAttachments } : {}),
      ...(includeAttachmentData ? { attachmentData: complaints.attachmentData } : {}),
      status: complaints.status,
      adminRemarks: complaints.adminRemarks,
      isAnonymous: complaints.isAnonymous,
      createdAt: complaints.createdAt,
      updatedAt: complaints.updatedAt,
      lastUpdatedByRole: complaints.lastUpdatedByRole,
      // CASE guarantees anonymous rows never carry identity, even if a join
      // is ever changed to an inner join by accident.
      studentName: sql<string | null>`case when ${complaints.isAnonymous} then null else ${sql.identifier("complaint_student")}.name end`,
      studentId: sql<string | null>`case when ${complaints.isAnonymous} then null else ${sql.identifier("complaint_student")}.student_number end`,
      program: sql<string | null>`case when ${complaints.isAnonymous} then null else ${sql.identifier("complaint_student")}.course end`,
      yearLevel: sql<number | null>`case when ${complaints.isAnonymous} then null else ${sql.identifier("complaint_student")}.year_level end`,
      email: sql<string | null>`case when ${complaints.isAnonymous} then null else ${sql.identifier("complaint_student")}.email end`,
      updatedByName: sql<string | null>`${sql.identifier("complaint_admin")}.name`,
    };
  }

  async findAdminPage(filters: ComplaintFilters) {
    const offset = (filters.page - 1) * filters.pageSize;

    try {
      const { student, admin, where } = this.adminQuery(filters);
      const rows = await db
        .select(this.adminSelect(false))
        .from(complaints)
        .leftJoin(
          complaintSubmitters,
          eq(complaintSubmitters.complaintId, complaints.id),
        )
        .leftJoin(
          student,
          and(
            eq(student.id, complaintSubmitters.userId),
            eq(complaints.isAnonymous, false),
          ),
        )
        .leftJoin(admin, eq(admin.id, complaints.lastUpdatedById))
        .where(where)
        .orderBy(desc(complaints.createdAt))
        .limit(filters.pageSize)
        .offset(offset);

      const [totalRow] = await db
        .select({ value: count() })
        .from(complaints)
        .leftJoin(
          complaintSubmitters,
          eq(complaintSubmitters.complaintId, complaints.id),
        )
        .leftJoin(
          student,
          and(
            eq(student.id, complaintSubmitters.userId),
            eq(complaints.isAnonymous, false),
          ),
        )
        .where(where);

      return { rows, total: Number(totalRow?.value ?? 0) };
    } catch {
      const filtered = memComplaints
        .filter((item) => matchesFilters(item, filters))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return {
        rows: filtered.slice(offset, offset + filters.pageSize),
        total: filtered.length,
      };
    }
  }

  /** Submitter account for notification delivery. Never exposed in responses. */
  async findSubmitterId(id: string): Promise<string | null> {
    try {
      const [row] = await db
        .select({ userId: complaintSubmitters.userId })
        .from(complaintSubmitters)
        .where(eq(complaintSubmitters.complaintId, id))
        .limit(1);
      return row?.userId ?? null;
    } catch {
      return memComplaints.find((item) => item.id === id)?.submitterId ?? null;
    }
  }

  async findAdminById(id: string) {    const student = alias(users, "complaint_student");
    const admin = alias(users, "complaint_admin");

    try {
      const [row] = await db
        .select(this.adminSelect(true))
        .from(complaints)
        .leftJoin(
          complaintSubmitters,
          eq(complaintSubmitters.complaintId, complaints.id),
        )
        .leftJoin(
          student,
          and(
            eq(student.id, complaintSubmitters.userId),
            eq(complaints.isAnonymous, false),
          ),
        )
        .leftJoin(admin, eq(admin.id, complaints.lastUpdatedById))
        .where(eq(complaints.id, id))
        .limit(1);
      return row ?? null;
    } catch {
      return memComplaints.find((item) => item.id === id) ?? null;
    }
  }

  async getSummary() {
    try {
      const rows = await db
        .select({ status: complaints.status, value: count() })
        .from(complaints)
        .groupBy(complaints.status);
      return this.toSummary(rows);
    } catch {
      const rows = memComplaints.map((item) => ({ status: item.status, value: 1 }));
      return this.toSummary(rows);
    }
  }

  private toSummary(rows: { status: string; value: number | string }[]) {
    const summary = { total: 0, pending: 0, in_review: 0, resolved: 0 };
    for (const row of rows) {
      const value = Number(row.value);
      summary.total += value;
      if (row.status === "pending") summary.pending += value;
      else if (row.status === "in_review") summary.in_review += value;
      else if (row.status === "resolved") summary.resolved += value;
    }
    return summary;
  }

  // ── Admin write ────────────────────────────────────────────────────────────

  async update(
    id: string,
    input: ComplaintUpdateInput,
    admin: { id: string; role: string; name: string },
  ): Promise<ComplaintUpdateResult> {
    const now = new Date();

    try {
      return await db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(complaints)
          .where(eq(complaints.id, id))
          .limit(1);

        if (!current) return { kind: "not_found" as const };

        if (
          input.expectedUpdatedAt &&
          new Date(input.expectedUpdatedAt).getTime() !==
            new Date(current.updatedAt).getTime()
        ) {
          return { kind: "conflict" as const, complaint: current };
        }

        const [updated] = await tx
          .update(complaints)
          .set({
            ...(input.status ? { status: input.status } : {}),
            ...(input.adminRemarks !== undefined
              ? { adminRemarks: input.adminRemarks }
              : {}),
            lastUpdatedById: admin.id,
            lastUpdatedByRole: admin.role,
            updatedAt: now.toISOString(),
          })
          .where(eq(complaints.id, id))
          .returning();

        return { kind: "updated" as const, complaint: updated };
      });
    } catch {
      // Fall through to memory.
    }

    const current = memComplaints.find((item) => item.id === id);
    if (!current) return { kind: "not_found" };

    if (
      input.expectedUpdatedAt &&
      new Date(input.expectedUpdatedAt).getTime() !==
        new Date(current.updatedAt).getTime()
    ) {
      return { kind: "conflict", complaint: current };
    }

    if (input.status) current.status = input.status;
    if (input.adminRemarks !== undefined) current.adminRemarks = input.adminRemarks;
    current.lastUpdatedById = admin.id;
    current.lastUpdatedByRole = admin.role;
    current.lastUpdatedByName = admin.name;
    current.updatedAt = now.toISOString();
    return { kind: "updated", complaint: current };
  }
}
