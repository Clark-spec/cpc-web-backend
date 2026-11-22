import { z } from "zod";

export const createProfileCorrectionSchema = z.object({
  body: z.object({
    field: z.enum(["Full Name", "Gender", "Date of Birth", "Place of Birth", "Email Address"]),
    currentValue: z.string().max(500),
    correctValue: z.string().trim().min(1).max(500),
    reason: z.string().trim().min(1).max(200),
    attachmentName: z.string().trim().max(255).optional(),
    attachmentType: z.enum(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"]).optional(),
    attachmentData: z.string().max(12 * 1024 * 1024).regex(/^data:(?:image\/(?:jpeg|png|webp|heic|heif)|application\/pdf);base64,[A-Za-z0-9+/]+=*$/).optional(),
  }).superRefine((body, context) => {
    if (body.field === "Email Address" && !z.string().email().safeParse(body.correctValue).success) {
      context.addIssue({ code: "custom", path: ["correctValue"], message: "Enter a valid email address." });
    }
    if (Boolean(body.attachmentData) !== Boolean(body.attachmentType)) {
      context.addIssue({ code: "custom", path: ["attachmentData"], message: "A supported document file is required." });
    }
  }),
});

export const reviewProfileCorrectionSchema = z.object({
  body: z.object({
    status: z.enum(["approved", "rejected"]),
    adminRemarks: z.string().trim().max(500).default(""),
  }),
});
