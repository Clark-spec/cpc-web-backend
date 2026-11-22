import { z } from "zod";

export const createStudentAccountSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).max(120),
    section: z.string().trim().min(1).max(40),
    gender: z.enum(["Male", "Female", "Prefer not to say"]),
    dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date of birth must be a valid date.")
      .refine((value) => {
        const parsed = new Date(`${value}T00:00:00.000Z`);
        return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value && parsed <= new Date();
      }, "Enter a valid date of birth that is not in the future."),
  }),
});

export const changePasswordSchema = z.object({
  body: z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8).max(128),
  }),
});
