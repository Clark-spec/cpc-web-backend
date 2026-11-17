import { z } from "zod";

export const ACADEMIC_EVENT_CATEGORIES = [
  "enrollment",
  "examination",
  "school-event",
  "academic-activity",
  "holiday",
  "deadline",
  "orientation",
  "graduation",
  "faculty",
  "student",
  "institutional",
] as const;

export const ACADEMIC_EVENT_STATUSES = [
  "draft",
  "pending",
  "published",
  "archived",
  "cancelled",
] as const;

export const ACADEMIC_SEMESTERS = ["1st Semester", "2nd Semester", "Summer Term"] as const;

/** Statuses a student is allowed to see. Cancelled events stay listed so students can see the cancellation. */
export const STUDENT_VISIBLE_ACADEMIC_EVENT_STATUSES = ["published", "cancelled"] as const;

export function isStudentVisibleAcademicEventStatus(status: string): boolean {
  return (STUDENT_VISIBLE_ACADEMIC_EVENT_STATUSES as readonly string[]).includes(status);
}

const dateKey = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date (YYYY-MM-DD).")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Use a valid calendar date.");

const timeKey = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a valid 24-hour time (HH:MM).");

const schoolYear = z
  .string()
  .trim()
  .min(7, "School year is required.")
  .max(20, "School year must be 20 characters or fewer.")
  .regex(/^\d{4}\s?[–-]\s?\d{4}$/, "Use the format 2026–2027.");

const eventBody = z.object({
  title: z
    .string({ message: "Event title is required." })
    .trim()
    .min(3, "Event title must be at least 3 characters.")
    .max(160, "Event title must be 160 characters or fewer."),
  description: z
    .string()
    .trim()
    .max(2000, "Description must be 2000 characters or fewer.")
    .optional(),
  category: z.enum(ACADEMIC_EVENT_CATEGORIES, {
    message: "Select a valid event category.",
  }),
  startDate: dateKey,
  endDate: dateKey.optional().nullable(),
  startTime: timeKey.optional().nullable(),
  endTime: timeKey.optional().nullable(),
  allDay: z.boolean().optional(),
  schoolYear,
  semester: z.enum(ACADEMIC_SEMESTERS, {
    message: "Select a valid semester.",
  }),
  status: z.enum(ACADEMIC_EVENT_STATUSES).optional(),
  location: z.string().trim().max(160, "Location must be 160 characters or fewer.").optional().nullable(),
  organizer: z.string().trim().max(160, "Organizer must be 160 characters or fewer.").optional().nullable(),
  department: z.string().trim().max(120, "Office must be 120 characters or fewer.").optional().nullable(),
  notes: z.string().trim().max(1000, "Notes must be 1000 characters or fewer.").optional().nullable(),
  programs: z.array(z.string().trim().max(120)).max(20).optional(),
  targetAudience: z
    .string()
    .trim()
    .max(80, "Target audience must be 80 characters or fewer.")
    .optional(),
});

function refineDates(
  value: {
    startDate: string;
    endDate?: string | null;
    allDay?: boolean;
    startTime?: string | null;
    endTime?: string | null;
  },
  ctx: z.RefinementCtx,
) {
  if (value.endDate && value.endDate < value.startDate) {
    ctx.addIssue({
      code: "custom",
      path: ["endDate"],
      message: "End date cannot be earlier than the start date.",
    });
  }

  const sameDay = !value.endDate || value.endDate === value.startDate;
  if (
    value.allDay !== true &&
    sameDay &&
    value.startTime &&
    value.endTime &&
    value.endTime <= value.startTime
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["endTime"],
      message: "End time must be later than the start time.",
    });
  }
}

export const createAcademicEventSchema = z.object({
  body: eventBody.superRefine(refineDates),
});

export const updateAcademicEventSchema = z.object({
  body: eventBody
    .partial()
    .refine((value) => Object.keys(value).length > 0, {
      message: "Provide at least one field to update.",
    }),
});

export const listAcademicEventsSchema = z.object({
  query: z.object({
    schoolYear: z.string().trim().max(20).optional(),
    semester: z.enum(ACADEMIC_SEMESTERS).optional(),
    category: z.enum(ACADEMIC_EVENT_CATEGORIES).optional(),
    status: z.enum([...ACADEMIC_EVENT_STATUSES, "all"] as [string, ...string[]]).optional(),
    search: z.string().trim().max(120).optional(),
    from: dateKey.optional(),
    to: dateKey.optional(),
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(500).optional(),
  }),
});
