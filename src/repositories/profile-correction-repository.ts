import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { profileCorrectionRequests } from "@/db/schema";
import { UserRepository } from "@/repositories/user-repository";
import { StudentProfileRepository } from "@/repositories/student-profile-repository";

export type ProfileCorrectionInput = {
  field: string;
  currentValue: string;
  requestedValue: string;
  reason: string;
  attachmentName?: string;
  attachmentType?: string;
  attachmentData?: string;
};

export type ProfileCorrectionDecision = {
  status: "approved" | "rejected";
  adminRemarks: string;
};

type CorrectionRow = typeof profileCorrectionRequests.$inferSelect;
const userRepo = new UserRepository();
const profileRepo = new StudentProfileRepository();
const memoryRows: CorrectionRow[] = [];

function alreadyReviewedError() {
  const error = new Error("This correction request has already been reviewed.");
  Object.assign(error, { code: 409 });
  return error;
}

function courseCode(course: string | null | undefined): string {
  const value = (course ?? "").toLowerCase();
  if (value.includes("hospitality") || value.includes("bshm")) return "BSHM";
  if (value.includes("education") || value.includes("beed") || value.includes("elementary")) return "BEED";
  if (value.includes("secondary") || value.includes("bsed")) return "BSED";
  return "BSIT";
}

function mapRow(row: any) {
  return {
    id: row.id,
    referenceNumber: row.referenceNumber,
    studentUserId: row.studentUserId,
    studentId: row.studentId,
    studentName: row.studentName,
    course: row.course,
    year: row.year,
    section: row.section,
    email: row.email,
    field: row.field,
    currentValue: row.currentValue,
    requestedValue: row.requestedValue,
    reason: row.reason,
    attachmentName: row.attachmentName ?? null,
    attachmentType: row.attachmentType ?? null,
    attachmentData: row.attachmentData ?? null,
    submittedAt: row.submittedAt,
    status: row.status,
    adminRemarks: row.adminRemarks ?? "",
    reviewedAt: row.reviewedAt ?? null,
  };
}

export class ProfileCorrectionRepository {
  private async applyApprovedValue(row: CorrectionRow) {
    let updated: unknown;
    if (row.field === "Full Name") {
      updated = await userRepo.updateStudentName(row.studentUserId, row.requestedValue);
    } else if (row.field === "Email Address") {
      updated = await userRepo.updateStudentEmail(row.studentUserId, row.requestedValue.trim().toLowerCase());
    } else {
      const profileField = row.field === "Gender"
        ? "gender"
        : row.field === "Date of Birth"
          ? "dateOfBirth"
          : row.field === "Place of Birth"
            ? "placeOfBirth"
            : null;
      if (!profileField) throw new Error("This profile field cannot be corrected.");
      updated = await profileRepo.upsert(row.studentUserId, { [profileField]: row.requestedValue });
    }
    if (!updated) throw new Error("The student record could not be updated.");
  }

  async create(studentUserId: string, input: ProfileCorrectionInput) {
    const student = await userRepo.findById(studentUserId);
    if (!student || student.role !== "STUDENT") return null;

    const date = new Date();
    const row = {
      referenceNumber: `PCR-${date.toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 6).toUpperCase()}`,
      studentUserId,
      studentId: student.studentNumber ?? "",
      studentName: student.name ?? "Student",
      course: courseCode(student.course),
      year: Math.min(4, Math.max(1, Number(student.yearLevel) || 1)),
      section: student.section ?? "",
      email: student.email ?? "",
      field: input.field,
      currentValue: input.currentValue,
      requestedValue: input.requestedValue,
      reason: input.reason,
      attachmentName: input.attachmentName ?? null,
      attachmentType: input.attachmentType ?? null,
      attachmentData: input.attachmentData ?? null,
      status: "pending",
      adminRemarks: "",
      submittedAt: date.toISOString(),
      reviewedAt: null,
      reviewedById: null,
    };

    try {
      const [created] = await db.insert(profileCorrectionRequests).values(row).returning();
      if (created) return mapRow(created);
    } catch {
      // Continue with the in-process fallback when the database is unavailable.
    }

    const fallback = { id: randomUUID(), ...row } as CorrectionRow;
    memoryRows.unshift(fallback);
    return mapRow(fallback);
  }

  async list() {
    try {
      const rows = await db.select().from(profileCorrectionRequests).orderBy(desc(profileCorrectionRequests.submittedAt));
      const merged = new Map<string, ReturnType<typeof mapRow>>();
      for (const row of memoryRows) merged.set(row.id, mapRow(row));
      for (const row of rows) merged.set(row.id, mapRow(row));
      return [...merged.values()].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
    } catch {
      return memoryRows.map(mapRow).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
    }
  }

  async listByStudent(studentUserId: string) {
    try {
      const rows = await db.select().from(profileCorrectionRequests)
        .where(eq(profileCorrectionRequests.studentUserId, studentUserId))
        .orderBy(desc(profileCorrectionRequests.submittedAt));
      const merged = new Map<string, ReturnType<typeof mapRow>>();
      for (const row of memoryRows.filter((item) => item.studentUserId === studentUserId)) merged.set(row.id, mapRow(row));
      for (const row of rows) merged.set(row.id, mapRow(row));
      return [...merged.values()].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
    } catch {
      return memoryRows.filter((row) => row.studentUserId === studentUserId)
        .map(mapRow).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
    }
  }

  async decide(id: string, decision: ProfileCorrectionDecision, reviewerId: string) {
    const reviewedAt = new Date().toISOString();
    try {
      const [current] = await db.select().from(profileCorrectionRequests)
        .where(eq(profileCorrectionRequests.id, id)).limit(1);
      if (current) {
        if (current.status !== "pending") throw alreadyReviewedError();
        if (decision.status === "approved") await this.applyApprovedValue(current);
        const [updated] = await db.update(profileCorrectionRequests).set({
          status: decision.status,
          adminRemarks: decision.adminRemarks,
          reviewedAt,
          reviewedById: reviewerId,
        }).where(eq(profileCorrectionRequests.id, id)).returning();
        if (updated) return mapRow(updated);
      }
    } catch (error) {
      if ((error as { code?: number })?.code === 409) throw error;
      // Continue with the in-process fallback when the database is unavailable.
    }

    const row = memoryRows.find((item) => item.id === id);
    if (!row) return null;
    if (row.status !== "pending") throw alreadyReviewedError();
    if (decision.status === "approved") await this.applyApprovedValue(row);
    row.status = decision.status;
    row.adminRemarks = decision.adminRemarks;
    row.reviewedAt = reviewedAt;
    row.reviewedById = reviewerId;
    return mapRow(row);
  }
}
