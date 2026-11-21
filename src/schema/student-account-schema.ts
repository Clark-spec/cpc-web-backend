import { z } from "zod";

export const createStudentAccountSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).max(120),
    section: z.string().trim().min(1).max(40),
  }),
});

export const changePasswordSchema = z.object({
  body: z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8).max(128),
  }),
});
