import { z } from "zod";

/** Must stay in sync with the student portal's category list. */
export const COMPLAINT_CATEGORIES = [
  "Academic Concern",
  "Facilities & Maintenance",
  "Student Conduct",
  "Financial / Billing",
  "Health & Safety",
  "Discrimination or Harassment",
  "Other",
] as const;

export const COMPLAINT_STATUSES = ["pending", "in_review", "resolved"] as const;
export const COMPLAINT_STATUS_FILTERS = [
  "pending",
  "in_review",
  "resolved",
  "all",
] as const;

export const COMPLAINT_COOLDOWN_HOURS = 72;
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const ACCEPTED_ATTACHMENT_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
];

const attachmentSchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    type: z.string().refine((value) => ACCEPTED_ATTACHMENT_TYPES.includes(value), {
      message: "Attachment must be a PDF, PNG, or JPG file.",
    }),
    size: z
      .number()
      .int()
      .positive()
      .max(MAX_ATTACHMENT_BYTES, "Attachment must be 5 MB or smaller."),
    /** Base64 data URL. */
    data: z.string().min(1).max(8_000_000),
  })
  .refine(
    (file) => {
      const comma = file.data.indexOf(",");
      if (comma < 0) return false;
      const base64 = file.data.slice(comma + 1);
      const padding = (base64.match(/=+$/) ?? [""])[0].length;
      const bytes = Math.floor((base64.length * 3) / 4) - padding;
      return bytes > 0 && bytes <= MAX_ATTACHMENT_BYTES;
    },
    { message: "Attachment must be 5 MB or smaller.", path: ["data"] },
  );

export const createComplaintSchema = z.object({
  body: z.object({
    subject: z
      .string({ message: "Subject is required" })
      .trim()
      .min(5, "Subject must be at least 5 characters")
      .max(120, "Subject must be 120 characters or fewer"),
    category: z.enum(COMPLAINT_CATEGORIES, {
      message: "Select a valid complaint category",
    }),
    description: z
      .string({ message: "Description is required" })
      .trim()
      .min(20, "Description must be at least 20 characters")
      .max(2000, "Description must be 2000 characters or fewer"),
    isAnonymous: z.boolean().optional(),
    attachment: attachmentSchema.nullish(),
    attachments: z.array(attachmentSchema).max(2).optional(),
  }),
});

export const updateComplaintSchema = z.object({
  body: z
    .object({
      status: z.enum(COMPLAINT_STATUSES).optional(),
      adminRemarks: z
        .string()
        .max(500, "Remarks must be 500 characters or fewer")
        .optional(),
      expectedUpdatedAt: z.string().optional(),
    })
    .refine((value) => value.status !== undefined || value.adminRemarks !== undefined, {
      message: "Provide a status or admin remarks to update.",
    }),
});

export const listComplaintsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(500).optional(),
    search: z.string().max(120).optional(),
    status: z.enum(COMPLAINT_STATUS_FILTERS).optional(),
    category: z.string().max(80).optional(),
    from: z.string().optional(),
    to: z.string().optional(),
  }),
});
