import { eq } from "drizzle-orm";
import { db } from "@/db";
import { enrollmentSessions, masterlist, notifications, users } from "@/db/schema";
import { broadcastNotificationCreated } from "@/services/sse";

export type SignatureOffice = "screening" | "guidance" | "clinic" | "registrar" | "accounting";
type Snapshot = Record<string, any>;

const offices: Record<SignatureOffice, { label: string; role: string; href: string }> = {
  screening: { label: "Screening Committee & Dean", role: "DEAN", href: "/committee/screening" },
  guidance: { label: "Guidance Counselor", role: "GUIDANCE", href: "/guidance/queue" },
  clinic: { label: "Clinic", role: "CLINIC", href: "/clinic/queue" },
  registrar: { label: "Registrar", role: "REGISTRAR", href: "/registrar/queue" },
  accounting: { label: "Accounting", role: "ACCOUNTING", href: "/accounting/queue" },
};

function asOffice(value: unknown): SignatureOffice | null {
  return typeof value === "string" && value in offices ? value as SignatureOffice : null;
}

async function actorRecord(actorId: string) {
  const [actor] = await db.select().from(users).where(eq(users.id, actorId)).limit(1);
  return actor ?? null;
}

async function ownStudentId(actorId: string) {
  const [student] = await db.select({ studentNumber: users.studentNumber }).from(users).where(eq(users.id, actorId)).limit(1);
  return student?.studentNumber ?? null;
}

function departmentMatches(actorDepartment: string | null, studentDepartment: string) {
  if (!actorDepartment) return true;
  const actor = actorDepartment.toUpperCase();
  const student = studentDepartment.toUpperCase();
  if (actor.includes("COMPUTER") || actor.includes("BSIT")) return student.includes("BSIT") || student.includes("COMPUTER");
  if (actor.includes("TEACHER") || actor.includes("BEED")) return student.includes("BEED") || student.includes("TEACHER");
  if (actor.includes("HOSPITALITY") || actor.includes("BSHM")) return student.includes("BSHM") || student.includes("HOSPITALITY");
  return actor === student;
}

function mayHandleOffice(role: string, office: SignatureOffice) {
  return role === "ADMIN" || offices[office].role === role;
}

async function notify(userId: string, officeId: string, title: string, message: string, href: string, type: "info" | "success" | "warning" = "info") {
  const [item] = await db.insert(notifications).values({ userId, officeId, title, message, href, type }).returning();
  if (item) broadcastNotificationCreated(item.userId, {
    id: item.id,
    title: item.title,
    message: item.message,
    type: item.type,
    href: item.href,
    createdAt: item.createdAt,
  });
}

async function notifyOffice(office: SignatureOffice, department: string, title: string, message: string) {
  const recipients = await db.select({ id: users.id, department: users.department }).from(users)
    .where(eq(users.role, offices[office].role as typeof users.$inferSelect.role));
  const targets = recipients.filter((user) => office !== "screening" || departmentMatches(user.department, department));
  const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, "ADMIN"));
  await Promise.all([...new Set([...targets.map((user) => user.id), ...admins.map((admin) => admin.id)])]
    .map((id) => notify(id, office, title, message, offices[office].href)));
}

async function notifyStudent(studentId: string, office: SignatureOffice, title: string, message: string, type: "info" | "success" | "warning" = "info") {
  const [student] = await db.select({ id: users.id }).from(users).where(eq(users.studentNumber, studentId)).limit(1);
  if (student) await notify(student.id, office, title, message, "/student/queue", type);
}

export async function getOwnEnrollmentSession(actorId: string) {
  const studentId = await ownStudentId(actorId);
  if (!studentId) return { code: 404, message: "Student enrollment record was not found." };
  const [row] = await db.select({ session: enrollmentSessions.session }).from(enrollmentSessions)
    .where(eq(enrollmentSessions.studentId, studentId)).limit(1);
  return row ? { code: 200, data: { session: row.session } } : { code: 404, message: "No saved enrollment session was found." };
}

export async function getOfficeSignatureRequests(actorId: string, role: string, officeInput: unknown) {
  const office = asOffice(officeInput);
  if (!office || !mayHandleOffice(role, office)) return { code: 403, message: "You cannot view this office's signature requests." };
  const actor = await actorRecord(actorId);
  const rows = await db.select({ session: enrollmentSessions.session }).from(enrollmentSessions);
  const sessions = rows.map((row) => row.session as Snapshot).filter((session) => {
    if (!session?.signatureRequests?.[office] || session.steps?.[office]?.status === "APPROVED") return false;
    return role !== "DEAN" || departmentMatches(actor?.department ?? null, String(session.student?.department ?? ""));
  });
  return { code: 200, data: { sessions } };
}

export async function submitEnrollmentSession(actorId: string, input: unknown) {
  const studentId = await ownStudentId(actorId);
  if (!studentId) return { code: 403, message: "Only a student account can submit an enrollment Study Load." };
  const [record] = await db.select().from(masterlist).where(eq(masterlist.studentIdNo, studentId)).limit(1);
  if (!record) return { code: 404, message: "Student masterlist record was not found." };
  const supplied = input && typeof input === "object" ? input as Snapshot : {};
  const form = supplied.form && typeof supplied.form === "object" ? supplied.form as Snapshot : {};
  const subjects = Array.isArray(form.subjects) ? form.subjects : [];
  if (!subjects.length) return { code: 400, message: "Add at least one subject before submitting the Study Load." };
  const now = new Date().toISOString();
  const session: Snapshot = {
    ...supplied,
    student: {
      studentIdNo: record.studentIdNo,
      name: record.name,
      department: record.department,
      course: record.course,
      yearLevel: record.yearLevel,
      semester: record.semester,
      standing: record.standing,
      lastTermEnrolled: record.lastTermEnrolled,
      isEligible: record.isEligible,
      email: supplied.student?.email,
    },
    form: {
      ...form,
      id: String(form.id || `form-${studentId}`),
      studentId,
      studentName: record.name,
      department: record.department,
      course: record.course,
      yearLevel: record.yearLevel,
      status: "SUBMITTED",
      subjects,
      totalUnits: subjects.reduce((sum: number, subject: Snapshot) => sum + Number(subject.units || 0), 0),
      submittedAt: now,
    },
    steps: {
      ...supplied.steps,
      screening: { ...supplied.steps?.screening, status: "PENDING" },
      guidance: { ...supplied.steps?.guidance, status: "PENDING" },
      clinic: { ...supplied.steps?.clinic, status: "PENDING" },
      accounting: { ...supplied.steps?.accounting, status: "LOCKED" },
      registrar: { ...supplied.steps?.registrar, status: "LOCKED" },
    },
    signatureRequests: {},
  };
  await db.insert(enrollmentSessions).values({ studentId, session }).onConflictDoUpdate({
    target: enrollmentSessions.studentId,
    set: { session, updatedAt: now },
  });
  await notifyStudent(studentId, "screening", "Study Load submitted", "Your Study Load is saved. Send a signature request to each office when ready.");
  return { code: 200, data: { session } };
}

export async function requestOfficeSignature(actorId: string, studentIdInput: string, officeInput: unknown) {
  const studentId = await ownStudentId(actorId);
  const office = asOffice(officeInput);
  if (!studentId || studentId !== studentIdInput || !office) return { code: 403, message: "This signature request is not authorized." };
  const [row] = await db.select().from(enrollmentSessions).where(eq(enrollmentSessions.studentId, studentId)).limit(1);
  if (!row) return { code: 404, message: "Submit your Study Load before requesting signatures." };
  const session = row.session as Snapshot;
  const signed = (key: string) => session.steps?.[key]?.status === "APPROVED";
  const formReady = ["SUBMITTED", "APPROVED"].includes(String(session.form?.status));
  const firstThreeSigned = signed("screening") && signed("guidance") && signed("clinic");
  const available = office === "screening" || office === "guidance" || office === "clinic"
    ? formReady && !signed(office)
    : firstThreeSigned && !signed(office);
  if (!available) return { code: 409, message: "This signature request is not available yet." };
  if (session.signatureRequests?.[office] && session.steps?.[office]?.status !== "RESUBMIT") return { code: 409, message: "You already sent a request to this office." };
  const now = new Date().toISOString();
  session.signatureRequests = { ...session.signatureRequests, [office]: now };
  session.steps[office] = { ...session.steps[office], status: "PENDING" };
  await db.update(enrollmentSessions).set({ session, updatedAt: now }).where(eq(enrollmentSessions.studentId, studentId));
  const fullName = String(session.student?.name ?? studentId);
  await notifyOffice(office, String(session.student?.department ?? ""), `Signature Requested: ${offices[office].label}`, `${fullName} (${studentId}) requested an enrollment signature.`);
  await notifyStudent(studentId, office, `Request sent to ${offices[office].label}`, `Your Study Load signature request was sent to ${offices[office].label}.`, "success");
  return { code: 200, data: { session } };
}

export async function signEnrollmentStep(actorId: string, role: string, studentId: string, officeInput: unknown, feePaid: boolean) {
  const office = asOffice(officeInput);
  if (!office || !mayHandleOffice(role, office)) return { code: 403, message: "Your account cannot sign for this office." };
  if (office === "screening" && !feePaid) return { code: 400, message: "Confirm the ₱100 department fee was paid before signing." };
  const actor = await actorRecord(actorId);
  const [row] = await db.select().from(enrollmentSessions).where(eq(enrollmentSessions.studentId, studentId)).limit(1);
  if (!row) return { code: 404, message: "Enrollment Study Load was not found." };
  const session = row.session as Snapshot;
  if (!session.signatureRequests?.[office]) return { code: 409, message: "The student has not requested this office's signature." };
  if (role === "DEAN" && !departmentMatches(actor?.department ?? null, String(session.student?.department ?? ""))) {
    return { code: 403, message: "You can only sign for your assigned department." };
  }
  if ((office === "registrar" || office === "accounting") && !(session.steps?.screening?.status === "APPROVED" && session.steps?.guidance?.status === "APPROVED" && session.steps?.clinic?.status === "APPROVED")) {
    return { code: 409, message: "Registrar and Accounting signatures unlock after the first three offices sign." };
  }
  const now = new Date().toISOString();
  session.steps[office] = { ...session.steps[office], status: "APPROVED", updatedBy: actor?.name ?? role, updatedAt: now };
  if (office === "guidance") session.form.status = "APPROVED";
  if (office === "screening") {
    session.screeningFeePaidAt = now;
    session.screeningFeeVerifiedBy = actor?.name ?? role;
  }
  await db.update(enrollmentSessions).set({ session, updatedAt: now }).where(eq(enrollmentSessions.studentId, studentId));
  const label = offices[office].label;
  await notifyStudent(studentId, office, `${label} signature completed`, `${label} digitally signed your Study Load.`, "success");
  const allSigned = (["screening", "guidance", "clinic", "accounting", "registrar"] as SignatureOffice[]).every((key) => session.steps?.[key]?.status === "APPROVED");
  if (allSigned) {
    await notifyStudent(studentId, office, "You are officially enrolled", `All five offices signed your Study Load for ${session.form?.term ?? "this term"}.`, "success");
  }
  return { code: 200, data: { session, allSigned } };
}
