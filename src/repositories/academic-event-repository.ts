import { and, asc, count, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "@/db";
import { academicEvents } from "@/db/schema";
import { SEED_ACADEMIC_EVENTS } from "@/db/academic-event-seed";
import {
  STUDENT_VISIBLE_ACADEMIC_EVENT_STATUSES,
  isStudentVisibleAcademicEventStatus,
} from "@/schema/academic-calendar-schema";

export type AcademicEventRecord = {
  id: string;
  title: string;
  description: string;
  category: string;
  startDate: string;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  schoolYear: string;
  semester: string;
  status: string;
  location: string | null;
  organizer: string | null;
  department: string | null;
  notes: string | null;
  programs: string[];
  targetAudience: string | null;
  createdById: string | null;
  createdByRole: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AcademicEventInput = {
  title: string;
  description: string;
  category: string;
  startDate: string;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  schoolYear: string;
  semester: string;
  status: string;
  location: string | null;
  organizer: string | null;
  department: string | null;
  notes: string | null;
  programs: string[];
  targetAudience: string | null;
};

export type AcademicEventPatch = Partial<AcademicEventInput>;

export type AcademicEventFilters = {
  schoolYear?: string;
  semester?: string;
  category?: string;
  status?: string;
  /** Restricts the result to specific statuses (used for student visibility). */
  statuses?: string[];
  search?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
};

export type AcademicEventActor = {
  id: string | null;
  role: string | null;
};

export type AcademicEventPage = {
  events: AcademicEventRecord[];
  total: number;
};

// ─── In-memory fallback (used when Postgres is unavailable) ──────────────────

function fromSeed(): AcademicEventRecord[] {
  const now = new Date().toISOString();
  return SEED_ACADEMIC_EVENTS.map((item) => ({
    id: item.id,
    title: item.title,
    description: item.description,
    category: item.category,
    startDate: item.startDate,
    endDate: item.endDate ?? null,
    startTime: item.startTime ?? null,
    endTime: item.endTime ?? null,
    allDay: item.allDay,
    schoolYear: item.schoolYear,
    semester: item.semester,
    status: item.status,
    location: item.location ?? null,
    organizer: item.organizer ?? null,
    department: item.department ?? null,
    notes: item.notes ?? null,
    programs: item.programs,
    targetAudience: item.targetAudience ?? null,
    createdById: null,
    createdByRole: item.createdByRole ?? null,
    createdAt: now,
    updatedAt: now,
  }));
}

const memEvents: AcademicEventRecord[] = fromSeed();

function toRecord(row: typeof academicEvents.$inferSelect): AcademicEventRecord {
  return {
    ...row,
    description: row.description ?? "",
    endDate: row.endDate ?? null,
    startTime: row.startTime ?? null,
    endTime: row.endTime ?? null,
    location: row.location ?? null,
    organizer: row.organizer ?? null,
    department: row.department ?? null,
    notes: row.notes ?? null,
    programs: row.programs ?? [],
    targetAudience: row.targetAudience ?? null,
    createdById: row.createdById ?? null,
    createdByRole: row.createdByRole ?? null,
  };
}

function matches(event: AcademicEventRecord, filters: AcademicEventFilters) {
  if (filters.schoolYear && event.schoolYear !== filters.schoolYear) return false;
  if (filters.semester && event.semester !== filters.semester) return false;
  if (filters.category && event.category !== filters.category) return false;
  if (filters.status && event.status !== filters.status) return false;
  if (filters.statuses && !filters.statuses.includes(event.status)) return false;

  const end = event.endDate ?? event.startDate;
  if (filters.from && end < filters.from) return false;
  if (filters.to && event.startDate > filters.to) return false;

  const query = (filters.search ?? "").trim().toLowerCase();
  if (query) {
    const haystack = [
      event.title,
      event.description,
      event.location,
      event.organizer,
      event.department,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(query)) return false;
  }

  return true;
}

function sortForCalendar(events: AcademicEventRecord[]) {
  return [...events].sort((a, b) => {
    if (a.startDate !== b.startDate) return a.startDate.localeCompare(b.startDate);
    return (a.startTime ?? "").localeCompare(b.startTime ?? "");
  });
}

const dbConditions = (filters: AcademicEventFilters) => {
  const conditions = [
    filters.schoolYear ? eq(academicEvents.schoolYear, filters.schoolYear) : undefined,
    filters.semester ? eq(academicEvents.semester, filters.semester) : undefined,
    filters.category ? eq(academicEvents.category, filters.category) : undefined,
    filters.status ? eq(academicEvents.status, filters.status) : undefined,
    filters.statuses ? inArray(academicEvents.status, filters.statuses) : undefined,
    filters.from
      ? gte(
          sql`coalesce(${academicEvents.endDate}, ${academicEvents.startDate})`,
          filters.from,
        )
      : undefined,
    filters.to ? lte(academicEvents.startDate, filters.to) : undefined,
  ].filter(Boolean);

  const query = (filters.search ?? "").trim();
  if (query) {
    const like = `%${query}%`;
    conditions.push(
      or(
        ilike(academicEvents.title, like),
        ilike(academicEvents.description, like),
        ilike(academicEvents.location, like),
        ilike(academicEvents.organizer, like),
        ilike(academicEvents.department, like),
      ),
    );
  }

  return conditions.length > 0 ? and(...(conditions as any[])) : undefined;
};

export class AcademicEventRepository {
  async findPage(
    filters: AcademicEventFilters,
    options: { publicOnly: boolean },
  ): Promise<AcademicEventPage> {
    const scoped = options.publicOnly
      ? { ...filters, status: undefined, statuses: [...STUDENT_VISIBLE_ACADEMIC_EVENT_STATUSES] }
      : filters;
    const offset = (filters.page - 1) * filters.pageSize;

    try {
      const where = dbConditions(scoped);
      const [rows, [totalRow]] = await Promise.all([
        db
          .select()
          .from(academicEvents)
          .where(where)
          .orderBy(asc(academicEvents.startDate), asc(academicEvents.startTime))
          .limit(filters.pageSize)
          .offset(offset),
        db.select({ value: count() }).from(academicEvents).where(where),
      ]);

      return {
        events: rows.map(toRecord),
        total: Number(totalRow?.value ?? 0),
      };
    } catch {
      const filtered = sortForCalendar(memEvents.filter((event) => matches(event, scoped)));
      return {
        events: filtered.slice(offset, offset + filters.pageSize),
        total: filtered.length,
      };
    }
  }

  async findById(id: string, options: { publicOnly: boolean }): Promise<AcademicEventRecord | null> {
    try {
      const [row] = await db
        .select()
        .from(academicEvents)
        .where(eq(academicEvents.id, id))
        .limit(1);
      if (!row) return null;
      const record = toRecord(row);
      if (options.publicOnly && !isStudentVisibleAcademicEventStatus(record.status)) return null;
      return record;
    } catch {
      const event = memEvents.find((item) => item.id === id) ?? null;
      if (!event) return null;
      if (options.publicOnly && !isStudentVisibleAcademicEventStatus(event.status)) return null;
      return event;
    }
  }

  async create(input: AcademicEventInput, actor: AcademicEventActor): Promise<AcademicEventRecord> {
    try {
      const [row] = await db
        .insert(academicEvents)
        .values({
          ...input,
          createdById: actor.id,
          createdByRole: actor.role,
        })
        .returning();
      return toRecord(row);
    } catch {
      // Fall through to memory when Postgres is unreachable.
    }

    const now = new Date().toISOString();
    const event: AcademicEventRecord = {
      ...input,
      id: randomUUID(),
      createdById: actor.id,
      createdByRole: actor.role,
      createdAt: now,
      updatedAt: now,
    };
    memEvents.push(event);
    return event;
  }

  async update(
    id: string,
    patch: AcademicEventPatch,
    actor: AcademicEventActor,
  ): Promise<AcademicEventRecord | null> {
    try {
      const [row] = await db
        .update(academicEvents)
        .set({
          ...patch,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(academicEvents.id, id))
        .returning();
      if (row) return toRecord(row);
    } catch {
      // Fall through to memory.
    }

    const current = memEvents.find((item) => item.id === id);
    if (!current) return null;
    Object.assign(current, patch, {
      updatedAt: new Date().toISOString(),
      createdById: current.createdById,
      createdByRole: current.createdByRole,
    });
    if (actor.role) current.createdByRole = current.createdByRole ?? actor.role;
    return current;
  }

  async remove(id: string): Promise<boolean> {
    try {
      const [row] = await db
        .delete(academicEvents)
        .where(eq(academicEvents.id, id))
        .returning({ id: academicEvents.id });
      if (row) return true;
    } catch {
      // Fall through to memory.
    }

    const index = memEvents.findIndex((item) => item.id === id);
    if (index < 0) return false;
    memEvents.splice(index, 1);
    return true;
  }
}
