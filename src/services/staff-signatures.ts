import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { staffSignatures } from "@/db/schema";

type SignatureMethod = "draw" | "type" | "upload";
const validMethods: SignatureMethod[] = ["draw", "type", "upload"];

function validImage(value: unknown): value is string {
  return typeof value === "string" && value.length <= 3_000_000 &&
    /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(value);
}

async function listRows(userId: string) {
  return db.select().from(staffSignatures).where(eq(staffSignatures.userId, userId)).orderBy(asc(staffSignatures.createdAt));
}

function shape(rows: Awaited<ReturnType<typeof listRows>>, userId: string) {
  return rows.map((row) => ({
    id: row.id,
    staffId: userId,
    imageBase64: row.imageBase64,
    method: row.method as SignatureMethod,
    label: row.label,
    isDefault: row.isDefault,
    createdAt: row.createdAt,
  }));
}

export async function listStaffSignatures(userId: string) {
  const rows = await listRows(userId);
  return { code: 200, data: { signatures: shape(rows, userId) } };
}

export async function createStaffSignature(userId: string, input: unknown) {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  if (!validImage(value.imageBase64) || !validMethods.includes(value.method as SignatureMethod)) {
    return { code: 400, message: "Provide a valid PNG or JPEG signature." };
  }
  const rows = await listRows(userId);
  const makeDefault = value.isDefault === true || rows.length === 0;
  if (makeDefault) await db.update(staffSignatures).set({ isDefault: false }).where(eq(staffSignatures.userId, userId));
  await db.insert(staffSignatures).values({
    userId,
    label: typeof value.label === "string" ? value.label.trim().slice(0, 80) || "Signature" : "Signature",
    imageBase64: value.imageBase64,
    method: value.method as SignatureMethod,
    isDefault: makeDefault,
  });
  return listStaffSignatures(userId);
}

export async function updateStaffSignature(userId: string, signatureId: string, input: unknown) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(signatureId)) {
    return { code: 404, message: "Saved signature was not found." };
  }
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const [existing] = await db.select({ id: staffSignatures.id }).from(staffSignatures)
    .where(and(eq(staffSignatures.id, signatureId), eq(staffSignatures.userId, userId))).limit(1);
  if (!existing) return { code: 404, message: "Saved signature was not found." };
  const changes: Partial<typeof staffSignatures.$inferInsert> = {};
  if (typeof value.label === "string") changes.label = value.label.trim().slice(0, 80) || "Signature";
  if (typeof value.isDefault === "boolean") changes.isDefault = value.isDefault;
  if (value.isDefault === true) await db.update(staffSignatures).set({ isDefault: false }).where(eq(staffSignatures.userId, userId));
  await db.update(staffSignatures).set(changes).where(and(eq(staffSignatures.id, signatureId), eq(staffSignatures.userId, userId)));
  return listStaffSignatures(userId);
}

export async function deleteStaffSignature(userId: string, signatureId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(signatureId)) {
    return { code: 404, message: "Saved signature was not found." };
  }
  const [existing] = await db.select({ id: staffSignatures.id }).from(staffSignatures)
    .where(and(eq(staffSignatures.id, signatureId), eq(staffSignatures.userId, userId))).limit(1);
  if (!existing) return { code: 404, message: "Saved signature was not found." };
  await db.delete(staffSignatures).where(and(eq(staffSignatures.id, signatureId), eq(staffSignatures.userId, userId)));
  const rows = await listRows(userId);
  if (rows.length && !rows.some((row) => row.isDefault)) {
    await db.update(staffSignatures).set({ isDefault: true }).where(eq(staffSignatures.id, rows[0].id));
  }
  return listStaffSignatures(userId);
}
