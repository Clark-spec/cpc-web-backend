import { and, count, desc, eq, gte, ilike, lt, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { randomUUID } from "node:crypto";
import { db } from "@/db";
import {
  serviceRequestDrafts,
  serviceRequestHistory,
  serviceRequests,
  services,
  purposes,
  users,
} from "@/db/schema";
import { UserRepository } from "@/repositories/user-repository";

export const SERVICE_REQUEST_STATUSES = [
  "submitted",
  "under_review",
  "processing",
  "ready_for_release",
  "released",
  "rejected",
] as const;

export type ServiceRequestStatus = (typeof SERVICE_REQUEST_STATUSES)[number];

/** Rows written before the canonical status list existed use older aliases. */
export function normalizeRequestStatus(value: unknown): ServiceRequestStatus {
  const key = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (key === "under_review" || key === "review" || key === "reviewing") {
    return "under_review";
  }
  if (key === "processing" || key === "in_progress") return "processing";
  if (key === "ready_for_release" || key === "ready" || key === "for_release") {
    return "ready_for_release";
  }
  if (key === "released" || key === "completed" || key === "done") return "released";
  if (key === "rejected" || key === "denied") return "rejected";
  return "submitted";
}

export const SERVICE_REQUEST_STATUS_LABELS: Record<ServiceRequestStatus, string> = {
  submitted: "Submitted",
  under_review: "Under Review",
  processing: "Processing",
  ready_for_release: "Ready for Release",
  released: "Released",
  rejected: "Rejected",
};

/** Two identical submissions inside this window are treated as a double-click. */
const DUPLICATE_WINDOW_MS = 15_000;

export type ServiceRequestAttachmentInput = {
  name: string;
  type: string;
  size: number;
  /** Base64 data URL. */
  data: string;
};

export type NewServiceRequestInput = {
  serviceId: number;
  copies: number;
  purpose: string;
  notes: string;
  attachment?: ServiceRequestAttachmentInput | null;
  attachments?: ServiceRequestAttachmentInput[];
};

export type ServiceRequestFilters = {
  page: number;
  pageSize: number;
  search?: string;
  status?: string;
  serviceId?: number;
  from?: string;
  to?: string;
};

export type ServiceRequestUpdateInput = {
  status?: string;
  remarks?: string;
  expectedUpdatedAt?: string;
};

export type ServiceRequestDraftInput = {
  serviceId: number | null;
  copies: number;
  purpose: string;
  notes: string;
  attachment?: ServiceRequestAttachmentInput | null;
  attachments?: ServiceRequestAttachmentInput[];
};

export type ServiceRequestCreateResult =
  | { kind: "created"; request: any }
  | { kind: "duplicate"; request: any };

export type ServiceRequestUpdateResult =
  | { kind: "updated"; request: any; historyEntry: any }
  | { kind: "not_found" }
  | { kind: "conflict"; request: any }
  | { kind: "released_locked"; request: any };

const DEFAULT_SERVICES = [
  { id: 1, code: "TOR", name: "Transcript of Records", description: "Official copy of academic transcript", fee: 150, active: true },
  { id: 2, code: "COG", name: "Certificate of Graduation", description: "Official certificate confirming graduation", fee: 100, active: true },
  { id: 3, code: "COE", name: "Certificate of Enrollment", description: "Certifies current enrollment status", fee: 50, active: true },
  { id: 4, code: "GRC", name: "Good Moral Certificate", description: "Certificate of good moral character", fee: 50, active: true },
  { id: 5, code: "CERT_GRADES", name: "Certified True Copy of Grades", description: "Certified copy of grades per semester", fee: 75, active: true },
];

const DEFAULT_PURPOSES = [
  { id: 1, label: "Employment", sortOrder: 0 },
  { id: 2, label: "Scholarship", sortOrder: 1 },
  { id: 3, label: "School Requirement", sortOrder: 2 },
  { id: 4, label: "Personal Use", sortOrder: 3 },
  { id: 5, label: "Board Exam", sortOrder: 4 },
  { id: 6, label: "Other", sortOrder: 5 },
];

type MemService = { id: number; name: string; code: string; fee: number };

type MemRequest = {
  id: string;
  referenceNumber: string;
  userId: string;
  serviceId: number;
  copies: number;
  purpose: string | null;
  notes: string | null;
  attachmentName: string | null;
  attachmentType: string | null;
  attachmentSize: number | null;
  attachmentData: string | null;
  additionalAttachments: ServiceRequestAttachmentInput[];
  status: string;
  remarks: string | null;
  lastUpdatedById: string | null;
  lastUpdatedByRole: string | null;
  lastUpdatedByName: string | null;
  submittedAt: string;
  updatedAt: string;
  service: MemService | null;
  // Identity snapshot, captured at submit time.
  studentName: string | null;
  studentNumber: string | null;
  course: string | null;
  yearLevel: number | null;
  email: string | null;
};

type MemHistory = {
  id: string;
  requestId: string;
  oldStatus: string | null;
  newStatus: string;
  changedById: string | null;
  changedByRole: string | null;
  changedByName: string | null;
  remarks: string | null;
  createdAt: string;
};

type MemDraft = {
  userId: string;
  serviceId: number | null;
  copies: number;
  purpose: string | null;
  notes: string | null;
  attachmentName: string | null;
  attachmentType: string | null;
  attachmentSize: number | null;
  attachmentData: string | null;
  additionalAttachments: ServiceRequestAttachmentInput[];
  updatedAt: string;
};

const memRequests: MemRequest[] = [];
const memHistory: MemHistory[] = [];
const memDrafts = new Map<string, MemDraft>();

function nextReference(now: Date) {
  const year = now.getUTCFullYear();
  const prefix = `SR-${year}-`;
  const highest = memRequests.reduce((max, item) => {
    if (!item.referenceNumber.startsWith(prefix)) return max;
    const n = Number(item.referenceNumber.slice(prefix.length));
    return Number.isFinite(n) ? Math.max(max, n) : max;
  }, 0);
  return `${prefix}${String(highest + 1).padStart(6, "0")}`;
}

function matchesAdminFilters(item: MemRequest, filters: ServiceRequestFilters) {
  const query = (filters.search ?? "").trim().toLowerCase();
  if (query) {
    const haystack = [
      item.referenceNumber,
      item.service?.name ?? "",
      item.purpose ?? "",
      item.notes ?? "",
      item.studentName ?? "",
      item.studentNumber ?? "",
    ]
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(query)) return false;
  }
  if (filters.status && filters.status !== "all") {
    if (normalizeRequestStatus(item.status) !== filters.status) return false;
  }
  if (filters.serviceId && item.serviceId !== filters.serviceId) return false;
  const submitted = item.submittedAt.slice(0, 10);
  if (filters.from && submitted < filters.from) return false;
  if (filters.to && submitted > filters.to) return false;
  return true;
}

function withServiceSnapshot(item: MemRequest): MemRequest {
  if (item.service) return item;
  const svc = DEFAULT_SERVICES.find((s) => s.id === item.serviceId);
  return {
    ...item,
    service: svc ? { id: svc.id, name: svc.name, code: svc.code, fee: svc.fee } : null,
  };
}

export class ServiceCatalogRepository {
  async getAllServices() {
    try {
      const svcs = await db.select().from(services).where(eq(services.active, true));
      if (svcs && svcs.length > 0) return svcs;
    } catch {
      // Fall through to memory
    }
    return DEFAULT_SERVICES;
  }

  async getAllPurposes() {
    try {
      const purps = await db.select().from(purposes).orderBy(purposes.sortOrder);
      if (purps && purps.length > 0) return purps;
    } catch {
      // Fall through to memory
    }
    return DEFAULT_PURPOSES;
  }

  async findServiceById(id: number) {
    try {
      const [svc] = await db.select().from(services).where(eq(services.id, id)).limit(1);
      if (svc) return svc;
    } catch {
      // Fall through to memory
    }
    return DEFAULT_SERVICES.find((s) => s.id === id) ?? null;
  }

  async seedCatalogIfEmpty() {
    try {
      const existing = await db.select({ id: services.id }).from(services).limit(1);
      if (existing.length > 0) return;

      await db.insert(services).values([
        { code: "TOR", name: "Transcript of Records", description: "Official copy of academic transcript", fee: 150 },
        { code: "COG", name: "Certificate of Graduation", description: "Official certificate confirming graduation", fee: 100 },
        { code: "COE", name: "Certificate of Enrollment", description: "Certifies current enrollment status", fee: 50 },
        { code: "GRC", name: "Good Moral Certificate", description: "Certificate of good moral character", fee: 50 },
        { code: "CERT_GRADES", name: "Certified True Copy of Grades", description: "Certified copy of grades per semester", fee: 75 },
      ]);

      const existingPurposes = await db.select({ id: purposes.id }).from(purposes).limit(1);
      if (existingPurposes.length > 0) return;

      await db.insert(purposes).values([
        { label: "Employment", sortOrder: 0 },
        { label: "Scholarship", sortOrder: 1 },
        { label: "School Requirement", sortOrder: 2 },
        { label: "Personal Use", sortOrder: 3 },
        { label: "Board Exam", sortOrder: 4 },
        { label: "Other", sortOrder: 5 },
      ]);
    } catch {
      // In-memory defaults already in place
    }
  }
}

export class ServiceRequestRepository {
  // ── Student reads ──────────────────────────────────────────────────────────

  async findByUserId(userId: string) {
    try {
      const rows = await db
        .select({
          id: serviceRequests.id,
          referenceNumber: serviceRequests.referenceNumber,
          copies: serviceRequests.copies,
          purpose: serviceRequests.purpose,
          notes: serviceRequests.notes,
          status: serviceRequests.status,
          remarks: serviceRequests.remarks,
          attachmentName: serviceRequests.attachmentName,
          attachmentType: serviceRequests.attachmentType,
          attachmentSize: serviceRequests.attachmentSize,
          additionalAttachments: serviceRequests.additionalAttachments,
          submittedAt: serviceRequests.submittedAt,
          updatedAt: serviceRequests.updatedAt,
          service: {
            id: services.id,
            name: services.name,
            code: services.code,
            fee: services.fee,
          },
        })
        .from(serviceRequests)
        .innerJoin(services, eq(serviceRequests.serviceId, services.id))
        .where(eq(serviceRequests.userId, userId))
        .orderBy(desc(serviceRequests.submittedAt));
      if (rows) return rows;
    } catch {
      // Fall through to memory
    }

    return memRequests
      .filter((r) => r.userId === userId)
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  }

  /** Own record plus the attachment payload, used for detail and downloads. */
  async findByIdAndUserId(id: string, userId: string) {
    try {
      const [req] = await db
        .select({
          id: serviceRequests.id,
          referenceNumber: serviceRequests.referenceNumber,
          copies: serviceRequests.copies,
          purpose: serviceRequests.purpose,
          notes: serviceRequests.notes,
          status: serviceRequests.status,
          remarks: serviceRequests.remarks,
          attachmentName: serviceRequests.attachmentName,
          attachmentType: serviceRequests.attachmentType,
          attachmentSize: serviceRequests.attachmentSize,
          attachmentData: serviceRequests.attachmentData,
          additionalAttachments: serviceRequests.additionalAttachments,
          lastUpdatedByRole: serviceRequests.lastUpdatedByRole,
          submittedAt: serviceRequests.submittedAt,
          updatedAt: serviceRequests.updatedAt,
          service: {
            id: services.id,
            name: services.name,
            code: services.code,
            fee: services.fee,
          },
        })
        .from(serviceRequests)
        .innerJoin(services, eq(serviceRequests.serviceId, services.id))
        .where(and(eq(serviceRequests.id, id), eq(serviceRequests.userId, userId)))
        .limit(1);
      if (req) return req;
    } catch {
      // Fall through to memory
    }

    return memRequests.find((r) => r.id === id && r.userId === userId) ?? null;
  }

  // ── Student drafts ─────────────────────────────────────────────────────────

  async findDraftByUserId(userId: string) {
    try {
      const [row] = await db
        .select()
        .from(serviceRequestDrafts)
        .where(eq(serviceRequestDrafts.userId, userId))
        .limit(1);
      if (row) return row;
    } catch {
      // Fall through to memory
    }

    return memDrafts.get(userId) ?? null;
  }

  async saveDraft(userId: string, data: ServiceRequestDraftInput) {
    const now = new Date();

    try {
      const values = {
        userId,
        serviceId: data.serviceId,
        copies: data.copies,
        purpose: data.purpose || null,
        notes: data.notes || null,
        attachmentName: data.attachment?.name ?? null,
        attachmentType: data.attachment?.type ?? null,
        attachmentSize: data.attachment?.size ?? null,
        attachmentData: data.attachment?.data ?? null,
        additionalAttachments: data.attachments ?? [],
        updatedAt: now.toISOString(),
      };

      const [row] = await db
        .insert(serviceRequestDrafts)
        .values(values)
        .onConflictDoUpdate({
          target: serviceRequestDrafts.userId,
          set: {
            serviceId: values.serviceId,
            copies: values.copies,
            purpose: values.purpose,
            notes: values.notes,
            attachmentName: values.attachmentName,
            attachmentType: values.attachmentType,
            attachmentSize: values.attachmentSize,
            attachmentData: values.attachmentData,
            additionalAttachments: values.additionalAttachments,
            updatedAt: values.updatedAt,
          },
        })
        .returning();
      if (row) return row;
    } catch {
      // Fall through to memory
    }

    const draft: MemDraft = {
      userId,
      serviceId: data.serviceId,
      copies: data.copies,
      purpose: data.purpose || null,
      notes: data.notes || null,
      attachmentName: data.attachment?.name ?? null,
      attachmentType: data.attachment?.type ?? null,
      attachmentSize: data.attachment?.size ?? null,
      attachmentData: data.attachment?.data ?? null,
      additionalAttachments: data.attachments ?? [],
      updatedAt: now.toISOString(),
    };
    memDrafts.set(userId, draft);
    return draft;
  }

  async deleteDraftByUserId(userId: string) {
    try {
      await db.delete(serviceRequestDrafts).where(eq(serviceRequestDrafts.userId, userId));
      return;
    } catch {
      // Fall through to memory
    }

    memDrafts.delete(userId);
  }

  // ── Student write ──────────────────────────────────────────────────────────

  async create(
    userId: string,
    data: NewServiceRequestInput,
  ): Promise<ServiceRequestCreateResult> {
    const now = new Date();
    const since = new Date(now.getTime() - DUPLICATE_WINDOW_MS).toISOString();

    try {
      const result = await db.transaction(async (tx) => {
        // Serialise reference generation and the per-student duplicate check so
        // a double-click cannot create two rows.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`service-requests:user:${userId}`}))`,
        );
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext('service-requests:reference'))`,
        );

        const [recent] = await tx
          .select()
          .from(serviceRequests)
          .where(
            and(
              eq(serviceRequests.userId, userId),
              eq(serviceRequests.serviceId, data.serviceId),
              eq(serviceRequests.copies, data.copies),
              gte(serviceRequests.submittedAt, since),
            ),
          )
          .orderBy(desc(serviceRequests.submittedAt))
          .limit(1);

        if (recent) {
          return { kind: "duplicate" as const, request: recent };
        }

        const year = now.getUTCFullYear();
        const yearStart = new Date(Date.UTC(year, 0, 1));
        const [total] = await tx
          .select({ value: count() })
          .from(serviceRequests)
          .where(gte(serviceRequests.submittedAt, yearStart.toISOString()));
        const referenceNumber = `SR-${year}-${String(Number(total?.value ?? 0) + 1).padStart(6, "0")}`;

        const [created] = await tx
          .insert(serviceRequests)
          .values({
            referenceNumber,
            userId,
            serviceId: data.serviceId,
            copies: data.copies,
            purpose: data.purpose,
            notes: data.notes,
            attachmentName: data.attachment?.name ?? null,
            attachmentType: data.attachment?.type ?? null,
            attachmentSize: data.attachment?.size ?? null,
            attachmentData: data.attachment?.data ?? null,
            additionalAttachments: data.attachments ?? [],
            status: "submitted",
          })
          .returning();

        await tx.insert(serviceRequestHistory).values({
          requestId: created.id,
          oldStatus: null,
          newStatus: "submitted",
          changedById: userId,
          changedByName: null,
          changedByRole: "STUDENT",
          remarks: null,
          createdAt: now.toISOString(),
        });

        return { kind: "created" as const, request: created };
      });
      // The student gets a success response only after the request is in the
      // shared database, where the registrar queue and status actions read it.
      return result;
    } catch (error) {
      console.error("Service request database insert failed:", error);
      throw error;
    }
  }

  // ── History ────────────────────────────────────────────────────────────────

  async findHistory(requestId: string) {
    try {
      const changer = alias(users, "srh_admin");
      const rows = await db
        .select({
          id: serviceRequestHistory.id,
          oldStatus: serviceRequestHistory.oldStatus,
          newStatus: serviceRequestHistory.newStatus,
          changedByRole: serviceRequestHistory.changedByRole,
          changedByName: sql<string | null>`coalesce(${serviceRequestHistory.changedByName}, ${changer.name})`,
          remarks: serviceRequestHistory.remarks,
          createdAt: serviceRequestHistory.createdAt,
        })
        .from(serviceRequestHistory)
        .leftJoin(changer, eq(changer.id, serviceRequestHistory.changedById))
        .where(eq(serviceRequestHistory.requestId, requestId))
        .orderBy(serviceRequestHistory.createdAt);
      if (rows.length > 0) return rows;
    } catch {
      // Fall through to memory
    }

    return memHistory
      .filter((item) => item.requestId === requestId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  // ── Admin reads ────────────────────────────────────────────────────────────

  private adminQuery(filters: ServiceRequestFilters) {
    const student = alias(users, "sr_student");

    const conditions = [
      filters.status && filters.status !== "all"
        ? eq(serviceRequests.status, filters.status)
        : undefined,
      filters.serviceId ? eq(serviceRequests.serviceId, filters.serviceId) : undefined,
      filters.from
        ? gte(serviceRequests.submittedAt, new Date(`${filters.from}T00:00:00.000Z`).toISOString())
        : undefined,
      filters.to
        ? lt(
            serviceRequests.submittedAt,
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
          ilike(serviceRequests.referenceNumber, like),
          ilike(serviceRequests.purpose, like),
          ilike(serviceRequests.notes, like),
          ilike(services.name, like),
          ilike(student.name, like),
          ilike(student.studentNumber, like),
        ),
      );
    }

    const where = conditions.filter(Boolean);
    return {
      student,
      where: where.length > 0 ? and(...(where as any[])) : undefined,
    };
  }

  private adminSelect(includeAttachmentData: boolean) {
    const student = alias(users, "sr_student");
    const admin = alias(users, "sr_admin");
    return {
      id: serviceRequests.id,
      referenceNumber: serviceRequests.referenceNumber,
      userId: serviceRequests.userId,
      copies: serviceRequests.copies,
      purpose: serviceRequests.purpose,
      notes: serviceRequests.notes,
      status: serviceRequests.status,
      remarks: serviceRequests.remarks,
      attachmentName: serviceRequests.attachmentName,
      attachmentType: serviceRequests.attachmentType,
      attachmentSize: serviceRequests.attachmentSize,
      ...(includeAttachmentData ? { additionalAttachments: serviceRequests.additionalAttachments } : {}),
      ...(includeAttachmentData ? { attachmentData: serviceRequests.attachmentData } : {}),
      submittedAt: serviceRequests.submittedAt,
      updatedAt: serviceRequests.updatedAt,
      lastUpdatedByRole: serviceRequests.lastUpdatedByRole,
      lastUpdatedByName: sql<string | null>`coalesce(${admin.name}, ${serviceRequests.lastUpdatedByName})`,
      service: {
        id: services.id,
        name: services.name,
        code: services.code,
        fee: services.fee,
      },
      studentName: student.name,
      studentNumber: student.studentNumber,
      course: student.course,
      yearLevel: student.yearLevel,
      email: student.email,
    };
  }

  async findAdminPage(filters: ServiceRequestFilters) {
    const offset = (filters.page - 1) * filters.pageSize;

    try {
      const { student, where } = this.adminQuery(filters);
      const admin = alias(users, "sr_admin");
      const rows = await db
        .select(this.adminSelect(false))
        .from(serviceRequests)
        .innerJoin(services, eq(serviceRequests.serviceId, services.id))
        .leftJoin(student, eq(student.id, serviceRequests.userId))
        .leftJoin(admin, eq(admin.id, serviceRequests.lastUpdatedById))
        .where(where)
        .orderBy(desc(serviceRequests.submittedAt))
        .limit(filters.pageSize)
        .offset(offset);

      const [totalRow] = await db
        .select({ value: count() })
        .from(serviceRequests)
        .innerJoin(services, eq(serviceRequests.serviceId, services.id))
        .leftJoin(student, eq(student.id, serviceRequests.userId))
        .where(where);

      const pageIds = new Set(rows.map((row) => row.id));
      const pageReferences = new Set(rows.map((row) => row.referenceNumber));
      const localRows = memRequests
        .filter((item) => matchesAdminFilters(item, filters) && !pageIds.has(item.id) && !pageReferences.has(item.referenceNumber))
        .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
      return {
        rows: [...rows, ...localRows].slice(0, filters.pageSize),
        total: Number(totalRow?.value ?? 0) + localRows.length,
      };
    } catch {
      // Fall through to memory
    }

    const filtered = memRequests
      .filter((item) => matchesAdminFilters(item, filters))
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
    return {
      rows: filtered.slice(offset, offset + filters.pageSize),
      total: filtered.length,
    };
  }

  async findAdminById(id: string, referenceNumber?: string) {
    const student = alias(users, "sr_student");
    const admin = alias(users, "sr_admin");
    const legacyRequest = memRequests.find((item) => item.id === id);

    try {
      const [row] = await db
        .select(this.adminSelect(true))
        .from(serviceRequests)
        .innerJoin(services, eq(serviceRequests.serviceId, services.id))
        .leftJoin(student, eq(student.id, serviceRequests.userId))
        .leftJoin(admin, eq(admin.id, serviceRequests.lastUpdatedById))
        .where(or(
          eq(serviceRequests.id, id),
          ...(referenceNumber ? [eq(serviceRequests.referenceNumber, referenceNumber)] : []),
          ...(legacyRequest ? [eq(serviceRequests.referenceNumber, legacyRequest.referenceNumber)] : []),
        ))
        .limit(1);
      if (row) return row;
    } catch {
      // Fall through to memory
    }

    return legacyRequest ? withServiceSnapshot(legacyRequest) : null;
  }

  async getAdminSummary() {
    try {
      const rows = await db
        .select({ status: serviceRequests.status, value: count() })
        .from(serviceRequests)
        .groupBy(serviceRequests.status);
      return this.toSummary(rows);
    } catch {
      // Fall through to memory
    }
    return this.toSummary(memRequests.map((item) => ({ status: item.status, value: 1 })));
  }

  private toSummary(rows: { status: string; value: number | string }[]) {
    const summary: Record<ServiceRequestStatus | "total", number> = {
      total: 0,
      submitted: 0,
      under_review: 0,
      processing: 0,
      ready_for_release: 0,
      released: 0,
      rejected: 0,
    };
    for (const row of rows) {
      const value = Number(row.value);
      summary.total += value;
      summary[normalizeRequestStatus(row.status)] += value;
    }
    return summary;
  }

  // ── Admin write ────────────────────────────────────────────────────────────

  async update(
    id: string,
    input: ServiceRequestUpdateInput,
    admin: { id: string; role: string; name: string },
  ): Promise<ServiceRequestUpdateResult> {
    const now = new Date();

    try {
      return await db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(serviceRequests)
          .where(eq(serviceRequests.id, id))
          .limit(1);

        if (!current) return null;

        if (
          input.expectedUpdatedAt &&
          new Date(input.expectedUpdatedAt).getTime() !==
            new Date(current.updatedAt).getTime()
        ) {
          return { kind: "conflict" as const, request: current };
        }

        const nextStatus = input.status
          ? normalizeRequestStatus(input.status)
          : normalizeRequestStatus(current.status);
        if (normalizeRequestStatus(current.status) === "released" && nextStatus !== "released") {
          return { kind: "released_locked" as const, request: current };
        }
        const nextRemarks =
          input.remarks !== undefined ? input.remarks : current.remarks;
        const statusChanged = nextStatus !== normalizeRequestStatus(current.status);
        const remarksChanged =
          input.remarks !== undefined && input.remarks !== (current.remarks ?? "");

        const [updated] = await tx
          .update(serviceRequests)
          .set({
            status: nextStatus,
            remarks: nextRemarks,
            lastUpdatedById: admin.id,
            lastUpdatedByName: admin.name,
            lastUpdatedByRole: admin.role,
            updatedAt: now.toISOString(),
          })
          .where(eq(serviceRequests.id, id))
          .returning();

        let historyEntry: any = null;
        if (statusChanged || remarksChanged) {
          [historyEntry] = await tx
            .insert(serviceRequestHistory)
            .values({
              requestId: id,
              oldStatus: normalizeRequestStatus(current.status),
              newStatus: nextStatus,
              changedById: admin.id,
              changedByName: admin.name,
              changedByRole: admin.role,
              remarks: input.remarks !== undefined ? input.remarks : null,
              createdAt: now.toISOString(),
            })
            .returning();
        }

        return { kind: "updated" as const, request: updated, historyEntry };
      });
      if (result) return result;
    } catch {
      // Fall through to memory
    }

    const current = memRequests.find((item) => item.id === id);
    if (!current) return { kind: "not_found" };

    if (
      input.expectedUpdatedAt &&
      new Date(input.expectedUpdatedAt).getTime() !==
        new Date(current.updatedAt).getTime()
    ) {
      return { kind: "conflict", request: current };
    }

    const oldStatus = normalizeRequestStatus(current.status);
    const nextStatus = input.status ? normalizeRequestStatus(input.status) : oldStatus;
    if (oldStatus === "released" && nextStatus !== "released") {
      return { kind: "released_locked", request: current };
    }
    const statusChanged = nextStatus !== oldStatus;
    const remarksChanged =
      input.remarks !== undefined && input.remarks !== (current.remarks ?? "");

    current.status = nextStatus;
    if (input.remarks !== undefined) current.remarks = input.remarks;
    current.lastUpdatedById = admin.id;
    current.lastUpdatedByRole = admin.role;
    current.lastUpdatedByName = admin.name;
    current.updatedAt = now.toISOString();

    const historyEntry: MemHistory | null =
      statusChanged || remarksChanged
        ? {
            id: randomUUID(),
            requestId: id,
            oldStatus,
            newStatus: nextStatus,
            changedById: admin.id,
            changedByRole: admin.role,
            changedByName: admin.name,
            remarks: input.remarks !== undefined ? input.remarks : null,
            createdAt: current.updatedAt,
          }
        : null;
    if (historyEntry) memHistory.push(historyEntry);

    return { kind: "updated", request: current, historyEntry };
  }
}
