import { z } from "zod";
import { SERVICE_REQUEST_STATUSES } from "@/repositories/service-request-repository";

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

export const createServiceRequestSchema = z.object({
  body: z.object({
    serviceId: z.coerce
      .number({ message: "Select the service you need" })
      .int()
      .positive("Select the service you need"),
    copies: z.coerce
      .number()
      .int()
      .min(1, "Copies must be at least 1")
      .max(10, "Copies must be 10 or fewer")
      .optional(),
    purpose: z
      .string({ message: "Purpose is required" })
      .trim()
      .min(1, "Select the purpose of your request")
      .max(120, "Purpose must be 120 characters or fewer"),
    notes: z
      .string()
      .trim()
      .max(1000, "Notes must be 1000 characters or fewer")
      .optional(),
    attachment: attachmentSchema.nullish(),
  }),
});

export const saveServiceRequestDraftSchema = z.object({
  body: z.object({
    serviceId: z.coerce
      .number({ message: "Select a valid service" })
      .int()
      .positive("Select a valid service")
      .nullish(),
    copies: z.coerce.number().int().min(1).max(10).optional(),
    purpose: z.string().trim().max(120, "Purpose must be 120 characters or fewer").optional(),
    notes: z.string().trim().max(1000, "Notes must be 1000 characters or fewer").optional(),
    attachment: attachmentSchema.nullish(),
    /** Draft saves only: delete the attachment stored with the draft. */
    removeAttachment: z.boolean().optional(),
  }),
});

export const updateServiceRequestSchema = z.object({
  body: z
    .object({
      status: z.enum(SERVICE_REQUEST_STATUSES).optional(),
      remarks: z
        .string()
        .max(500, "Remarks must be 500 characters or fewer")
        .optional(),
      expectedUpdatedAt: z.string().optional(),
    })
    .refine((value) => value.status !== undefined || value.remarks !== undefined, {
      message: "Provide a status or remarks to update.",
    }),
});

export const listServiceRequestsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(500).optional(),
    search: z.string().max(120).optional(),
    status: z.enum([...SERVICE_REQUEST_STATUSES, "all"] as [string, ...string[]]).optional(),
    serviceId: z.coerce.number().int().positive().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
  }),
});
