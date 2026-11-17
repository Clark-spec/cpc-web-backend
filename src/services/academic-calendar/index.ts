import type { Request } from "express";
import {
  AcademicEventRepository,
  type AcademicEventActor,
  type AcademicEventInput,
  type AcademicEventPatch,
  type AcademicEventRecord,
  type AcademicEventFilters,
} from "@/repositories/academic-event-repository";
import type { AuthenticatedRequest } from "@/middlewares/auth-middleware";
import { UserRepository } from "@/repositories/user-repository";
import { NotificationRepository, type NotificationType } from "@/repositories/notification-repository";
import { isStudentVisibleAcademicEventStatus } from "@/schema/academic-calendar-schema";
import {
  broadcastAcademicCalendarUpdated,
  broadcastNotificationCreated,
} from "@/services/sse";

const repo = new AcademicEventRepository();
const userRepo = new UserRepository();
const notificationRepo = new NotificationRepository();

const STUDENT_CALENDAR_HREF = "/academics/academic-calendar";

type StudentCalendarAction = "created" | "updated" | "removed";

/** Roles that own Academics > Academic Calendar. */
export const ACADEMIC_CALENDAR_ADMIN_ROLES = ["ADMIN", "REGISTRAR", "DEAN"] as const;

export function canManageAcademicCalendar(role: string | undefined): boolean {
  return ACADEMIC_CALENDAR_ADMIN_ROLES.some((allowed) => allowed === role);
}

type ServiceResult = {
  code: number;
  status: "success" | "error";
  message?: string;
  data?: unknown;
  fields?: Record<string, string>;
};

/** Strips markup and control characters before anything is stored. */
function sanitizeText(value: string, maxLength: number): string {
  return value
    .replace(/<[^>]*>/g, "")
    .split("")
    .filter((character) => character >= " " && character !== "\u007F")
    .join("")
    .trim()
    .slice(0, maxLength);
}

function cleanOptional(value: string | null | undefined, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = sanitizeText(value, maxLength);
  return cleaned.length > 0 ? cleaned : null;
}

function cleanTime(value: string | null | undefined): string | null {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : null;
}

function normalizeInput(input: AcademicEventInput): AcademicEventInput {
  const allDay = input.allDay === true;
  return {
    title: sanitizeText(input.title, 160),
    description: sanitizeText(input.description ?? "", 2000),
    category: input.category,
    startDate: input.startDate,
    endDate: cleanOptional(input.endDate, 10),
    startTime: allDay ? null : cleanTime(input.startTime),
    endTime: allDay ? null : cleanTime(input.endTime),
    allDay,
    schoolYear: sanitizeText(input.schoolYear, 20),
    semester: input.semester,
    status: input.status || "draft",
    location: cleanOptional(input.location, 160),
    organizer: cleanOptional(input.organizer, 160),
    department: cleanOptional(input.department, 120),
    notes: cleanOptional(input.notes, 1000),
    programs: Array.isArray(input.programs)
      ? Array.from(
          new Set(
            input.programs
              .map((program) => sanitizeText(program, 120))
              .filter((program) => program.length > 0),
          ),
        ).slice(0, 20)
      : [],
    targetAudience: cleanOptional(input.targetAudience, 80),
  };
}

function bodyToInput(body: Record<string, unknown>): AcademicEventInput {
  return {
    title: String(body.title ?? ""),
    description: String(body.description ?? ""),
    category: String(body.category ?? ""),
    startDate: String(body.startDate ?? ""),
    endDate: typeof body.endDate === "string" ? body.endDate : null,
    startTime: typeof body.startTime === "string" ? body.startTime : null,
    endTime: typeof body.endTime === "string" ? body.endTime : null,
    allDay: body.allDay === true,
    schoolYear: String(body.schoolYear ?? ""),
    semester: String(body.semester ?? ""),
    status: typeof body.status === "string" ? body.status : "draft",
    location: typeof body.location === "string" ? body.location : null,
    organizer: typeof body.organizer === "string" ? body.organizer : null,
    department: typeof body.department === "string" ? body.department : null,
    notes: typeof body.notes === "string" ? body.notes : null,
    programs: Array.isArray(body.programs)
      ? body.programs.filter((program): program is string => typeof program === "string")
      : [],
    targetAudience: typeof body.targetAudience === "string" ? body.targetAudience : null,
  };
}

function mergePatch(current: AcademicEventRecord, patch: AcademicEventPatch): AcademicEventInput {
  return {
    title: patch.title ?? current.title,
    description: patch.description ?? current.description,
    category: patch.category ?? current.category,
    startDate: patch.startDate ?? current.startDate,
    endDate: patch.endDate !== undefined ? patch.endDate : current.endDate,
    startTime: patch.startTime !== undefined ? patch.startTime : current.startTime,
    endTime: patch.endTime !== undefined ? patch.endTime : current.endTime,
    allDay: patch.allDay ?? current.allDay,
    schoolYear: patch.schoolYear ?? current.schoolYear,
    semester: patch.semester ?? current.semester,
    status: patch.status ?? current.status,
    location: patch.location !== undefined ? patch.location : current.location,
    organizer: patch.organizer !== undefined ? patch.organizer : current.organizer,
    department: patch.department !== undefined ? patch.department : current.department,
    notes: patch.notes !== undefined ? patch.notes : current.notes,
    programs: patch.programs ?? current.programs,
    targetAudience: patch.targetAudience !== undefined ? patch.targetAudience : current.targetAudience,
  };
}

function validateDates(input: { startDate: string; endDate: string | null; allDay: boolean; startTime: string | null; endTime: string | null }): Record<string, string> | null {
  if (input.endDate && input.endDate < input.startDate) {
    return { endDate: "End date cannot be earlier than the start date." };
  }
  const sameDay = !input.endDate || input.endDate === input.startDate;
  if (!input.allDay && sameDay && input.startTime && input.endTime && input.endTime <= input.startTime) {
    return { endTime: "End time must be later than the start time." };
  }
  return null;
}

type StudentCalendarNotice =
  | "published"
  | "updated"
  | "cancelled"
  | "republished"
  | "removed";

function studentNotificationCopy(
  event: AcademicEventRecord,
  notice: StudentCalendarNotice,
): { title: string; message: string; type: NotificationType } {
  const when = event.startDate;
  switch (notice) {
    case "published":
      return {
        title: "New Calendar Event",
        message: `"${event.title}" was added to the academic calendar (${when}).`,
        type: "info",
      };
    case "cancelled":
      return {
        title: "Calendar Event Cancelled",
        message: `"${event.title}" has been cancelled. It stays on your academic calendar marked as cancelled.`,
        type: "warning",
      };
    case "republished":
      return {
        title: "Calendar Event Republished",
        message: `"${event.title}" is back on the academic calendar (${when}).`,
        type: "success",
      };
    case "removed":
      return {
        title: "Calendar Event Removed",
        message: `"${event.title}" was removed from the academic calendar.`,
        type: "warning",
      };
    default:
      return {
        title: "Calendar Event Updated",
        message: `"${event.title}" was updated on the academic calendar (${when}).`,
        type: "info",
      };
  }
}

/**
 * Fans a student-visible event change out to every student: one bell item plus
 * a calendar refresh signal, both over SSE so no page reload is needed.
 * Failures are contained so a notification problem never fails the save.
 */
async function notifyStudentsOfCalendarChange(
  event: AcademicEventRecord,
  notice: StudentCalendarNotice,
  action: StudentCalendarAction,
): Promise<void> {
  try {
    const studentIds = await userRepo.findIdsByRoles(["STUDENT"]);
    if (studentIds.length === 0) return;

    const copy = studentNotificationCopy(event, notice);

    await Promise.all(
      studentIds.map(async (studentId) => {
        try {
          const notification = await notificationRepo.create(studentId, {
            title: copy.title,
            message: copy.message,
            type: copy.type,
            href: STUDENT_CALENDAR_HREF,
          });
          broadcastNotificationCreated(studentId, {
            id: notification.id,
            title: notification.title ?? null,
            message: notification.message,
            type: notification.type,
            href: notification.href ?? null,
            createdAt: notification.createdAt,
          });
          broadcastAcademicCalendarUpdated(studentId, { eventId: event.id, action });
        } catch (error) {
          console.error("notifyStudentsOfCalendarChange Error:", error);
        }
      }),
    );
  } catch (error) {
    console.error("notifyStudentsOfCalendarChange Error:", error);
  }
}

function actorOf(req: Request): AcademicEventActor {
  const user = (req as AuthenticatedRequest).user;
  return { id: user?.sub ?? null, role: user?.role ?? null };
}

function filtersFromQuery(query: Request["query"]): AcademicEventFilters {
  const read = (key: string) => {
    const value = query[key];
    return Array.isArray(value) ? value[0] : value;
  };
  return {
    schoolYear: typeof read("schoolYear") === "string" ? String(read("schoolYear")) : undefined,
    semester: typeof read("semester") === "string" ? String(read("semester")) : undefined,
    category: typeof read("category") === "string" ? String(read("category")) : undefined,
    status:
      typeof read("status") === "string" && read("status") !== "all"
        ? String(read("status"))
        : undefined,
    search: typeof read("search") === "string" ? String(read("search")) : undefined,
    from: typeof read("from") === "string" ? String(read("from")) : undefined,
    to: typeof read("to") === "string" ? String(read("to")) : undefined,
    page: Math.max(1, Number(read("page")) || 1),
    pageSize: Math.min(500, Math.max(1, Number(read("pageSize")) || 200)),
  };
}

export async function listAcademicEventsService(
  req: Request,
  role: string | undefined,
): Promise<ServiceResult> {
  try {
    const filters = filtersFromQuery(req.query ?? {});
    const publicOnly = !canManageAcademicCalendar(role);
    const { events, total } = await repo.findPage(filters, { publicOnly });

    return {
      code: 200,
      status: "success",
      data: {
        events,
        pagination: {
          page: filters.page,
          pageSize: filters.pageSize,
          total,
          totalPages: Math.max(1, Math.ceil(total / filters.pageSize)),
        },
        filters: {
          schoolYear: filters.schoolYear ?? null,
          semester: filters.semester ?? null,
          category: filters.category ?? null,
          from: filters.from ?? null,
          to: filters.to ?? null,
        },
      },
    };
  } catch (error) {
    console.error("listAcademicEventsService Error:", error);
    return { code: 500, status: "error", message: "Failed to load the academic calendar." };
  }
}

export async function getAcademicEventService(
  id: string,
  role: string | undefined,
): Promise<ServiceResult> {
  try {
    const event = await repo.findById(id, {
      publicOnly: !canManageAcademicCalendar(role),
    });
    if (!event) {
      return {
        code: 404,
        status: "error",
        message: "That calendar event could not be found.",
      };
    }
    return { code: 200, status: "success", data: { event } };
  } catch (error) {
    console.error("getAcademicEventService Error:", error);
    return { code: 500, status: "error", message: "Failed to load the calendar event." };
  }
}

export async function createAcademicEventService(req: Request): Promise<ServiceResult> {
  try {
    const input = normalizeInput(bodyToInput((req.body ?? {}) as Record<string, unknown>));
    const dateError = validateDates(input);
    if (dateError) {
      return {
        code: 400,
        status: "error",
        message: "Please check the highlighted fields.",
        fields: dateError,
      };
    }

    const event = await repo.create(input, actorOf(req));
    if (event.status === "published") {
      await notifyStudentsOfCalendarChange(event, "published", "created");
    } else if (event.status === "cancelled") {
      await notifyStudentsOfCalendarChange(event, "cancelled", "created");
    }
    return {
      code: 201,
      status: "success",
      message: "Calendar event created.",
      data: { event },
    };
  } catch (error) {
    console.error("createAcademicEventService Error:", error);
    return { code: 500, status: "error", message: "Failed to create the calendar event." };
  }
}

export async function updateAcademicEventService(
  req: Request,
  id: string,
): Promise<ServiceResult> {
  try {
    const current = await repo.findById(id, { publicOnly: false });
    if (!current) {
      return {
        code: 404,
        status: "error",
        message: "That calendar event could not be found.",
      };
    }

    const raw = (req.body ?? {}) as Record<string, unknown>;
    const partial: AcademicEventPatch = {};
    const assign = <K extends keyof AcademicEventPatch>(key: K, value: AcademicEventPatch[K]) => {
      if (value !== undefined) partial[key] = value;
    };

    if (raw.title !== undefined) assign("title", sanitizeText(String(raw.title), 160));
    if (raw.description !== undefined)
      assign("description", sanitizeText(String(raw.description), 2000));
    if (raw.category !== undefined) assign("category", String(raw.category));
    if (raw.startDate !== undefined) assign("startDate", String(raw.startDate));
    if (raw.endDate !== undefined)
      assign("endDate", cleanOptional(raw.endDate as string | null, 10));
    if (raw.startTime !== undefined) assign("startTime", cleanTime(raw.startTime as string | null));
    if (raw.endTime !== undefined) assign("endTime", cleanTime(raw.endTime as string | null));
    if (raw.allDay !== undefined) assign("allDay", raw.allDay === true);
    if (raw.schoolYear !== undefined)
      assign("schoolYear", sanitizeText(String(raw.schoolYear), 20));
    if (raw.semester !== undefined) assign("semester", String(raw.semester));
    if (raw.status !== undefined) assign("status", String(raw.status));
    if (raw.location !== undefined)
      assign("location", cleanOptional(raw.location as string | null, 160));
    if (raw.organizer !== undefined)
      assign("organizer", cleanOptional(raw.organizer as string | null, 160));
    if (raw.department !== undefined)
      assign("department", cleanOptional(raw.department as string | null, 120));
    if (raw.notes !== undefined)
      assign("notes", cleanOptional(raw.notes as string | null, 1000));
    if (raw.programs !== undefined) {
      const programs = Array.isArray(raw.programs)
        ? raw.programs.filter((program): program is string => typeof program === "string")
        : [];
      assign(
        "programs",
        Array.from(
          new Set(programs.map((program) => sanitizeText(program, 120)).filter(Boolean)),
        ).slice(0, 20),
      );
    }
    if (raw.targetAudience !== undefined)
      assign("targetAudience", cleanOptional(raw.targetAudience as string | null, 80));

    const merged = normalizeInput(mergePatch(current, partial));
    const dateError = validateDates(merged);
    if (dateError) {
      return {
        code: 400,
        status: "error",
        message: "Please check the highlighted fields.",
        fields: dateError,
      };
    }

    // Snapshot before the write: the memory repository mutates the record in place.
    const previousStatus = current.status;

    const event = await repo.update(id, merged, actorOf(req));
    if (!event) {
      return {
        code: 404,
        status: "error",
        message: "That calendar event could not be found.",
      };
    }

    const wasVisible = isStudentVisibleAcademicEventStatus(previousStatus);
    if (isStudentVisibleAcademicEventStatus(event.status)) {
      let notice: StudentCalendarNotice;
      if (event.status === "published") {
        notice =
          previousStatus === "published"
            ? "updated"
            : previousStatus === "cancelled"
              ? "republished"
              : "published";
      } else {
        notice = previousStatus === "cancelled" ? "updated" : "cancelled";
      }
      await notifyStudentsOfCalendarChange(event, notice, wasVisible ? "updated" : "created");
    } else if (wasVisible) {
      await notifyStudentsOfCalendarChange(event, "removed", "removed");
    }

    return {
      code: 200,
      status: "success",
      message: "Calendar event updated.",
      data: { event },
    };
  } catch (error) {
    console.error("updateAcademicEventService Error:", error);
    return { code: 500, status: "error", message: "Failed to update the calendar event." };
  }
}

export async function deleteAcademicEventService(id: string): Promise<ServiceResult> {
  try {
    const current = await repo.findById(id, { publicOnly: false });
    if (!current) {
      return {
        code: 404,
        status: "error",
        message: "That calendar event could not be found.",
      };
    }

    const removed = await repo.remove(id);
    if (!removed) {
      return {
        code: 404,
        status: "error",
        message: "That calendar event could not be found.",
      };
    }

    if (isStudentVisibleAcademicEventStatus(current.status)) {
      await notifyStudentsOfCalendarChange(current, "removed", "removed");
    }

    return {
      code: 200,
      status: "success",
      message: "Calendar event deleted.",
      data: { id },
    };
  } catch (error) {
    console.error("deleteAcademicEventService Error:", error);
    return { code: 500, status: "error", message: "Failed to delete the calendar event." };
  }
}
