import { z } from "zod";

export const signupSchema = z.object({
  body: z.object({
    name: z
      .string({ message: "Name is required" })
      .min(2, "Name must be at least 2 characters"),
    email: z.string().email("Invalid email format"),
    password: z
      .string({ message: "Password is required" })
      .min(6, "Password must be at least 6 characters"),
    studentNumber: z.string().optional(),
    course: z.string().optional(),
    yearLevel: z.number().optional(),
    department: z.string().optional(),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    identifier: z.string().min(1, "Identifier is required").optional(),
    email: z.string().optional(),
    password: z.string().min(1, "Password is required"),
  }),
});

export const refreshTokenSchema = z.object({
  body: z.object({
    refreshToken: z.string().optional(),
  }),
});

export type SignupInput = z.infer<typeof signupSchema>["body"];
export type LoginInput = z.infer<typeof loginSchema>["body"];
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>["body"];
