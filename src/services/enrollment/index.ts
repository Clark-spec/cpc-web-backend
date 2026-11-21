import { and, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/db";
import { enrollmentSessions, masterlist, notifications, users } from "@/db/schema";
import { broadcastNotificationCreated, broadcastNotificationUpdated } from "@/services/sse";
import { UserRepository } from "@/repositories/user-repository";

const userRepository = new UserRepository();

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
  const actor = actorDepartment.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const student = studentDepartment.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const isComputerStudies = actor.includes("COMPUTER") || actor.includes("BSIT") || actor.includes("INFORMATIONTECHNOLOGY");
  const isInformationTechnology = student.includes("BSIT") || student.includes("COMPUTER") || student.includes("INFORMATIONTECHNOLOGY");
  if (isComputerStudies) return isInformationTechnology;
  const isTeacherEducation = actor.includes("TEACHER") || actor.includes("BEED") || actor.includes("ELEMENTARYEDUCATION");
  const isEducationStudent = student.includes("BEED") || student.includes("TEACHER") || student.includes("ELEMENTARYEDUCATION");
  if (isTeacherEducation) return isEducationStudent;
  const isHospitality = actor.includes("HOSPITALITY") || actor.includes("BSHM");
  const isHospitalityStudent = student.includes("BSHM") || student.includes("HOSPITALITY");
  if (isHospitality) return isHospitalityStudent;
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

async function notifyClearanceRequestIfMissing(
  userId: string,
  office: ClearanceOffice,
  record: Snapshot,
  requestedAt: string,
) {
  const title = `Clearance pending: ${clearanceLabels[office]}`;
  const message = `${record.studentName} (${record.studentId}) has a pending clearance signature request.`;
  const previousTitle = `Clearance request: ${clearanceLabels[office]}`;
  const previousMessage = `${record.studentName} (${record.studentId}) requested a clearance signature.`;
  const [existing] = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(
      eq(notifications.userId, userId),
      eq(notifications.officeId, office),
      inArray(notifications.title, [title, previousTitle]),
      inArray(notifications.message, [message, previousMessage]),
      gte(notifications.createdAt, requestedAt),
    ))
    .limit(1);
  if (!existing) {
    await notify(userId, office, title, message, `/admin/clearance-requests?office=${office}&student=${record.studentId}`);
  }
}

async function updateClearanceRequestNotifications(
  recipientIds: string[],
  office: ClearanceOffice,
  studentId: string,
  studentName: string,
  requestedAt: string | undefined,
  status: "pending" | "signed" | "rejected",
) {
  if (!recipientIds.length) return;
  const label = clearanceLabels[office];
  const title = `Clearance ${status}: ${label}`;
  const message = status === "pending"
    ? `${studentName} (${studentId}) has a pending clearance signature request.`
    : `${studentName} (${studentId}) clearance request was ${status}.`;
  const messages = [
    `${studentName} (${studentId}) requested a clearance signature.`,
    `${studentName} (${studentId}) has a pending clearance signature request.`,
    `${studentName} (${studentId}) clearance request was signed.`,
    `${studentName} (${studentId}) clearance request was rejected.`,
  ];
  const candidates = await db.select({ id: notifications.id, userId: notifications.userId })
    .from(notifications)
    .where(and(
      inArray(notifications.userId, recipientIds),
      eq(notifications.officeId, office),
      inArray(notifications.title, [
        `Clearance request: ${label}`,
        `Clearance pending: ${label}`,
        `Clearance signed: ${label}`,
        `Clearance rejected: ${label}`,
      ]),
      inArray(notifications.message, messages),
      ...(requestedAt ? [gte(notifications.createdAt, requestedAt)] : []),
    ));
  if (!candidates.length) return;
  await db.update(notifications)
    .set({ title, message, type: status === "signed" ? "success" : status === "rejected" ? "warning" : "info", read: false, readAt: null })
    .where(inArray(notifications.id, candidates.map((row) => row.id)));
  for (const userId of new Set(candidates.map((row) => row.userId))) {
    broadcastNotificationUpdated(userId);
  }
}

async function updateClearanceStudentNotification(
  studentUserId: string,
  office: ClearanceOffice,
  requestedAt: string | undefined,
  status: "pending" | "signed" | "rejected",
) {
  if (!requestedAt) return false;
  const label = clearanceLabels[office];
  const title = `Clearance ${status}: ${label}`;
  const message = status === "pending"
    ? `Your ${label} clearance request was sent and is pending review.`
    : `Your ${label} clearance request was ${status}.`;
  try {
    const candidates = await db.select({ id: notifications.id, title: notifications.title, userId: notifications.userId })
      .from(notifications)
      .where(and(
        eq(notifications.userId, studentUserId),
        eq(notifications.officeId, office),
        inArray(notifications.title, [
          `Clearance pending: ${label}`,
          `Clearance signed: ${label}`,
          `Clearance rejected: ${label}`,
        ]),
        inArray(notifications.message, [
          `Your ${label} clearance request was sent and is pending review.`,
          `Your ${label} clearance request was signed.`,
          `Your ${label} clearance request was rejected.`,
          `${label} signed your clearance request.`,
          `${label} rejected your clearance request.`,
        ]),
        gte(notifications.createdAt, requestedAt),
      ));
    if (!candidates.length) return false;
    const canonical = candidates.find((item) => item.title === `Clearance pending: ${label}`) ?? candidates[0];
    await db.update(notifications)
      .set({ title, message, type: status === "signed" ? "success" : status === "rejected" ? "warning" : "info", read: false, readAt: null })
      .where(eq(notifications.id, canonical.id));
    const duplicateIds = candidates.filter((item) => item.id !== canonical.id).map((item) => item.id);
    if (duplicateIds.length) await db.delete(notifications).where(inArray(notifications.id, duplicateIds));
    broadcastNotificationUpdated(studentUserId);
    return true;
  } catch (error) {
    console.error("Could not update student's clearance notification", error);
    return false;
  }
}

async function reconcileStudentClearanceNotifications(studentUserId: string, record: Snapshot) {
  try {
    for (const office of (record.offices ?? []) as Snapshot[]) {
      const targetStatus = office.status as "pending" | "signed" | "rejected" | "not_requested";
      const requestedAt = office.requestedAt as string | undefined;
      if (!requestedAt || !["requested", "pending", "signed", "rejected"].includes(targetStatus)) continue;
      const label = clearanceLabels[office.office as ClearanceOffice];
      if (!label) continue;
      const status = targetStatus === "requested" ? "pending" : targetStatus as "pending" | "signed" | "rejected";
      const title = `Clearance ${status}: ${label}`;
      const message = status === "pending"
        ? `Your ${label} clearance request was sent and is pending review.`
        : `Your ${label} clearance request was ${status}.`;
      const rows = await db.select({ id: notifications.id, title: notifications.title, message: notifications.message, type: notifications.type })
        .from(notifications)
        .where(and(
          eq(notifications.userId, studentUserId),
          eq(notifications.officeId, office.office),
          inArray(notifications.title, [
            `Clearance pending: ${label}`,
            `Clearance signed: ${label}`,
            `Clearance rejected: ${label}`,
          ]),
          gte(notifications.createdAt, requestedAt),
        ));
      if (!rows.length) continue;
      const canonical = rows.find((row) => row.title === `Clearance pending: ${label}`) ?? rows[0];
      const type = status === "signed" ? "success" : status === "rejected" ? "warning" : "info";
      const contentChanged = canonical.title !== title || canonical.message !== message || canonical.type !== type;
      if (contentChanged) {
        await db.update(notifications)
          .set({ title, message, type, read: false, readAt: null })
          .where(eq(notifications.id, canonical.id));
      }
      const duplicateIds = rows.filter((row) => row.id !== canonical.id).map((row) => row.id);
      if (duplicateIds.length) await db.delete(notifications).where(inArray(notifications.id, duplicateIds));
      if (contentChanged || duplicateIds.length) broadcastNotificationUpdated(studentUserId);
    }
  } catch (error) {
    console.error("Could not reconcile student's clearance notifications", error);
  }
}

async function notifyOffice(office: SignatureOffice, department: string, title: string, message: string) {
  await userRepository.ensureDemoStaffAccountsForRole(offices[office].role);
  const recipients = await db.select({ id: users.id, department: users.department }).from(users)
    .where(eq(users.role, offices[office].role as typeof users.$inferSelect.role));
  const targets = recipients.filter((user) => office !== "screening" || departmentMatches(user.department, department));
  const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, "ADMIN"));
  await Promise.all([...new Set([...targets.map((user) => user.id), ...admins.map((admin) => admin.id)])]
    .map((id) => notify(id, office, title, message, `/admin/enrollment/clearance-requests?office=${office}`)));
}

async function notifyStudent(studentId: string, office: SignatureOffice, title: string, message: string, type: "info" | "success" | "warning" = "info") {
  const [student] = await db.select({ id: users.id }).from(users).where(eq(users.studentNumber, studentId)).limit(1);
  if (student) await notify(student.id, office, title, message, "/student/queue", type);
}

/** Replace the original request alert with its final status for staff/admins. */
async function updateOfficeSignatureNotice(studentId: string, studentName: string, office: SignatureOffice, requestedAt: string, status: "signed" | "rejected") {
  const label = offices[office].label;
  const requestedTitle = `Signature Requested: ${label}`;
  const statusTitle = `Signature ${status === "signed" ? "Signed" : "Rejected"}: ${label}`;
  const messages = [
    `${studentName} (${studentId}) requested an enrollment signature.`,
    `${studentName} (${studentId}) enrollment signature request was ${status}.`,
  ];
  const rows = await db.select({ id: notifications.id, userId: notifications.userId, title: notifications.title, message: notifications.message, read: notifications.read })
    .from(notifications)
    .where(and(
      eq(notifications.officeId, office),
      inArray(notifications.title, [requestedTitle, statusTitle]),
      inArray(notifications.message, messages),
      gte(notifications.createdAt, requestedAt),
    ));
  const byRecipient = new Map<string, typeof rows>();
  for (const row of rows) byRecipient.set(row.userId, [...(byRecipient.get(row.userId) ?? []), row]);
  for (const [userId, recipientRows] of byRecipient) {
    const canonical = recipientRows.find((item) => item.title === requestedTitle) ?? recipientRows[0];
    const message = `${studentName} (${studentId}) enrollment signature request was ${status}.`;
    const changed = canonical.title !== statusTitle || canonical.message !== message || canonical.read;
    if (changed) {
      await db.update(notifications).set({
        title: statusTitle,
        message,
        type: status === "signed" ? "success" : "warning",
        read: false,
        readAt: null,
      }).where(eq(notifications.id, canonical.id));
    }
    const duplicateIds = recipientRows.filter((item) => item.id !== canonical.id).map((item) => item.id);
    if (duplicateIds.length) await db.delete(notifications).where(inArray(notifications.id, duplicateIds));
    if (changed || duplicateIds.length) broadcastNotificationUpdated(userId);
  }
}

/** Replace the student's pending request notice too, avoiding a second toast/card. */
async function updateStudentEnrollmentSignatureNotice(studentId: string, office: SignatureOffice, requestedAt: string, status: "signed" | "rejected") {
  const [student] = await db.select({ id: users.id }).from(users).where(eq(users.studentNumber, studentId)).limit(1);
  if (!student) return;
  const label = offices[office].label;
  const requestedTitle = `Request sent to ${label}`;
  const statusTitle = `Signature ${status === "signed" ? "signed" : "rejected"}: ${label}`;
  const rows = await db.select({ id: notifications.id, title: notifications.title, message: notifications.message, read: notifications.read })
    .from(notifications)
    .where(and(
      eq(notifications.userId, student.id),
      eq(notifications.officeId, office),
      inArray(notifications.title, [requestedTitle, statusTitle]),
      gte(notifications.createdAt, requestedAt),
    ));
  if (!rows.length) return;
  const canonical = rows.find((item) => item.title === requestedTitle) ?? rows[0];
  const message = `Your Study Load signature request to ${label} was ${status}.`;
  const changed = canonical.title !== statusTitle || canonical.message !== message || canonical.read;
  if (changed) {
    await db.update(notifications).set({
      title: statusTitle,
      message,
      type: status === "signed" ? "success" : "warning",
      read: false,
      readAt: null,
    }).where(eq(notifications.id, canonical.id));
  }
  const duplicateIds = rows.filter((item) => item.id !== canonical.id).map((item) => item.id);
  if (duplicateIds.length) await db.delete(notifications).where(inArray(notifications.id, duplicateIds));
  if (changed || duplicateIds.length) broadcastNotificationUpdated(student.id);
}

export async function getOwnEnrollmentSession(actorId: string) {
  const studentId = await ownStudentId(actorId);
  if (!studentId) return { code: 404, message: "Student enrollment record was not found." };
  const [row] = await db.select({ session: enrollmentSessions.session }).from(enrollmentSessions)
    .where(eq(enrollmentSessions.studentId, studentId)).limit(1);
  if (row) return { code: 200, data: { session: row.session } };

  const [record] = await db.select().from(masterlist).where(eq(masterlist.studentIdNo, studentId)).limit(1);
  if (!record) return { code: 404, message: "Student masterlist record was not found." };
  const [account] = await db.select({ section: users.section }).from(users).where(eq(users.id, actorId)).limit(1);
  const student = {
    studentIdNo: record.studentIdNo,
    section: account?.section ?? "",
    name: record.name,
    department: record.department,
    course: record.course,
    yearLevel: record.yearLevel,
    semester: record.semester,
    standing: record.standing,
    lastTermEnrolled: record.lastTermEnrolled,
    isEligible: record.isEligible,
  };
  const makeStep = (id: string, stepName: string, label: string, office: string, status: string) => ({ id, stepName, label, office, status });
  const session: Snapshot = {
    student,
    steps: {
      verification: makeStep("step-0", "verification", "Verification & Standing", "Registrar", "PENDING"),
      clearance: makeStep("step-1", "clearance", "Online Clearance Check", "Online Clearance", "LOCKED"),
      enrollment_form: makeStep("step-2", "enrollment_form", "Enrollment Form", "Student", "LOCKED"),
      screening: makeStep("step-3", "screening", "Screening Committee Approval", "Department Dean", "LOCKED"),
      guidance: makeStep("step-4", "guidance", "Guidance Office Approval", "Guidance", "LOCKED"),
      queue_ticket: makeStep("step-5", "queue_ticket", "Department Queue Number", "Registrar / Automated", "LOCKED"),
      clinic: makeStep("step-6", "clinic", "Clinic Health Assessment", "Clinic", "LOCKED"),
      accounting: makeStep("step-7", "accounting", "Accounting Fee Assessment", "Accounting", "LOCKED"),
      registrar: makeStep("step-8", "registrar", "Registrar Final Registration", "Registrar", "LOCKED"),
    },
    form: {
      id: `form-${studentId}`,
      studentId,
      studentName: record.name,
      department: record.department,
      course: record.course,
      yearLevel: record.yearLevel,
      term: "2nd Semester 2025-2026",
      type: record.standing === "regular" ? "preprinted" : "blank",
      standing: record.standing,
      subjects: [],
      totalUnits: 0,
      status: "DRAFT",
    },
    signatureRequests: {},
  };
  await db.insert(enrollmentSessions).values({ studentId, session }).onConflictDoNothing();
  const [saved] = await db.select({ session: enrollmentSessions.session }).from(enrollmentSessions)
    .where(eq(enrollmentSessions.studentId, studentId)).limit(1);
  return saved ? { code: 200, data: { session: saved.session } } : { code: 500, message: "Enrollment session could not be initialized." };
}

export async function confirmEnrollmentVerification(actorId: string) {
  const studentId = await ownStudentId(actorId);
  if (!studentId) return { code: 404, message: "Student enrollment record was not found." };
  const [record] = await db.select().from(masterlist).where(eq(masterlist.studentIdNo, studentId)).limit(1);
  if (!record) return { code: 404, message: "Student masterlist record was not found." };
  if (!record.isEligible) return { code: 403, message: "This student is not eligible for continuing online enrollment." };
  const loaded = await getOwnEnrollmentSession(actorId);
  if (loaded.code !== 200 || !loaded.data?.session) return loaded;
  const session = loaded.data.session as Snapshot;
  if (!["DRAFT", "RESUBMIT"].includes(String(session.form?.status))) {
    return { code: 409, message: "Verification is locked after the Study Load is submitted." };
  }
  const now = new Date().toISOString();
  session.steps.verification = { ...session.steps.verification, status: "APPROVED", updatedAt: now, updatedBy: record.name };
  session.steps.clearance = { ...session.steps.clearance, status: "PENDING" };
  await db.update(enrollmentSessions).set({ session, updatedAt: now }).where(eq(enrollmentSessions.studentId, studentId));
  return { code: 200, data: { session } };
}

export async function saveEnrollmentDraft(actorId: string, input: unknown) {
  const studentId = await ownStudentId(actorId);
  if (!studentId) return { code: 403, message: "Only a student account can save an enrollment Study Load." };
  const [row] = await db.select().from(enrollmentSessions).where(eq(enrollmentSessions.studentId, studentId)).limit(1);
  if (!row) return { code: 404, message: "Enrollment session was not found." };
  const session = row.session as Snapshot;
  if (!session?.steps?.verification || session.steps.verification.status !== "APPROVED") {
    return { code: 409, message: "Confirm your Registrar record before editing the Study Load." };
  }
  if (!["DRAFT", "RESUBMIT"].includes(String(session.form?.status))) {
    return { code: 409, message: "The submitted Study Load can no longer be edited." };
  }
  const subjects = input && typeof input === "object" && Array.isArray((input as Snapshot).subjects)
    ? (input as Snapshot).subjects as Snapshot[]
    : null;
  if (!subjects || subjects.length > 24) return { code: 400, message: "Provide a valid Study Load with no more than 24 subjects." };
  for (const subject of subjects) {
    if (typeof subject.code !== "string" || !subject.code.trim() || typeof subject.title !== "string" || !subject.title.trim() || !Number.isFinite(Number(subject.units)) || Number(subject.units) <= 0) {
      return { code: 400, message: "Each subject needs a code, title, and valid unit count." };
    }
  }
  const totalUnits = subjects.reduce((sum, subject) => sum + Number(subject.units), 0);
  const maximumUnits = session.form.standing === "regular" ? 27 : 24;
  if (totalUnits > maximumUnits) return { code: 400, message: `The Study Load cannot exceed ${maximumUnits} units.` };
  session.form = { ...session.form, subjects, totalUnits };
  if ((input as Snapshot).clearanceComplete === true) {
    session.steps.clearance = { ...session.steps.clearance, status: "APPROVED", updatedAt: new Date().toISOString() };
    session.steps.enrollment_form = { ...session.steps.enrollment_form, status: "PENDING" };
  }
  const now = new Date().toISOString();
  await db.update(enrollmentSessions).set({ session, updatedAt: now }).where(eq(enrollmentSessions.studentId, studentId));
  return { code: 200, data: { session } };
}

export async function getOfficeSignatureRequests(actorId: string, role: string, officeInput: unknown) {
  const office = asOffice(officeInput);
  if (!office || !mayHandleOffice(role, office)) return { code: 403, message: "You cannot view this office's signature requests." };
  const actor = await actorRecord(actorId);
  const rows = await db.select({ session: enrollmentSessions.session }).from(enrollmentSessions);
  const allSessions = rows.map((row) => row.session as Snapshot);
  await Promise.all(allSessions.filter((session) => session?.signatureRequests?.[office] && session.steps?.[office]?.status === "APPROVED")
    .map(async (session) => {
      const requestedAt = String(session.signatureRequests[office]);
      const studentId = String(session.student?.studentIdNo ?? "");
      const studentName = String(session.student?.name ?? studentId);
      if (!studentId) return;
      await Promise.all([
        updateOfficeSignatureNotice(studentId, studentName, office, requestedAt, "signed"),
        updateStudentEnrollmentSignatureNotice(studentId, office, requestedAt, "signed"),
      ]).catch((error) => console.error("Could not reconcile enrollment signature notifications", error));
    }));
  const sessions = allSessions.filter((session) => {
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
  const [account] = await db.select({ section: users.section }).from(users).where(eq(users.id, actorId)).limit(1);
  const [savedRow] = await db.select().from(enrollmentSessions).where(eq(enrollmentSessions.studentId, studentId)).limit(1);
  if (!savedRow) return { code: 409, message: "Verify your Registrar record before submitting the Study Load." };
  const savedSession = savedRow.session as Snapshot;
  if (savedSession.steps?.verification?.status !== "APPROVED") return { code: 409, message: "Confirm your Registrar record before submitting the Study Load." };
  if (!["DRAFT", "RESUBMIT"].includes(String(savedSession.form?.status))) {
    return { code: 409, message: "This Study Load has already been submitted." };
  }
  const supplied = input && typeof input === "object" ? input as Snapshot : {};
  const form = savedSession.form as Snapshot;
  const subjects = Array.isArray(form.subjects) ? form.subjects : [];
  if (!subjects.length) return { code: 400, message: "Add at least one subject before submitting the Study Load." };
  const totalUnits = subjects.reduce((sum: number, subject: Snapshot) => sum + Number(subject.units || 0), 0);
  const maximumUnits = record.standing === "regular" ? 27 : 24;
  if (totalUnits > maximumUnits) return { code: 400, message: `The Study Load cannot exceed ${maximumUnits} units.` };
  const now = new Date().toISOString();
  const session: Snapshot = {
    ...supplied,
    student: {
      studentIdNo: record.studentIdNo,
      section: account?.section ?? "",
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
      totalUnits,
      submittedAt: now,
    },
    steps: {
      ...savedSession.steps,
      clearance: { ...savedSession.steps?.clearance, ...(supplied.steps?.clearance ?? {}) },
      screening: { ...savedSession.steps?.screening, status: "PENDING" },
      guidance: { ...savedSession.steps?.guidance, status: "PENDING" },
      clinic: { ...savedSession.steps?.clinic, status: "PENDING" },
      accounting: { ...savedSession.steps?.accounting, status: "LOCKED" },
      registrar: { ...savedSession.steps?.registrar, status: "LOCKED" },
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

export async function cancelOfficeSignatureRequest(actorId: string, studentIdInput: string, officeInput: unknown) {
  const studentId = await ownStudentId(actorId);
  const office = asOffice(officeInput);
  if (!studentId || studentId !== studentIdInput || !office) return { code: 403, message: "This signature cancellation is not authorized." };
  const [row] = await db.select().from(enrollmentSessions).where(eq(enrollmentSessions.studentId, studentId)).limit(1);
  if (!row) return { code: 404, message: "Enrollment Study Load was not found." };
  const session = row.session as Snapshot;
  if (!session.signatureRequests?.[office] || session.steps?.[office]?.status === "APPROVED") {
    return { code: 409, message: "There is no cancellable signature request for this office." };
  }
  const requestedAt = session.signatureRequests[office] as string;
  const now = new Date().toISOString();
  const requests = { ...session.signatureRequests };
  delete requests[office];
  session.signatureRequests = requests;
  session.steps[office] = { ...session.steps[office], status: "PENDING", respondedAt: undefined, updatedAt: now };
  await db.update(enrollmentSessions).set({ session, updatedAt: now }).where(eq(enrollmentSessions.studentId, studentId));
  const fullName = String(session.student?.name ?? studentId);
  const label = offices[office].label;
  await notifyOffice(office, String(session.student?.department ?? ""), `Signature Request Cancelled: ${label}`, `${fullName} (${studentId}) cancelled their enrollment signature request.`);
  await notifyStudent(studentId, office, `Request cancelled: ${label}`, `Your Study Load signature request to ${label} was cancelled.`, "warning");
  return { code: 200, data: { session, cancelledAt: now, requestedAt } };
}

export async function signEnrollmentStep(actorId: string, role: string, studentId: string, officeInput: unknown, feePaid: boolean, signatureInput: unknown) {
  const office = asOffice(officeInput);
  if (!office || !mayHandleOffice(role, office)) return { code: 403, message: "Your account cannot sign for this office." };
  if (office === "screening" && !feePaid) return { code: 400, message: "Confirm the ₱100 department fee was paid before signing." };
  const actor = await actorRecord(actorId);
  const [row] = await db.select().from(enrollmentSessions).where(eq(enrollmentSessions.studentId, studentId)).limit(1);
  if (!row) return { code: 404, message: "Enrollment Study Load was not found." };
  const session = row.session as Snapshot;
  if (!session.signatureRequests?.[office]) return { code: 409, message: "The student has not requested this office's signature." };
  const signature = signatureInput && typeof signatureInput === "object" ? signatureInput as Snapshot : {};
  const imageBase64 = typeof signature.imageBase64 === "string" ? signature.imageBase64 : "";
  const signatureMethod = signature.method;
  if (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(imageBase64) || imageBase64.length > 3_000_000 || !["draw", "type", "upload"].includes(signatureMethod)) {
    return { code: 400, message: "Add a valid digital signature before signing this Study Load." };
  }
  if (role === "DEAN" && !departmentMatches(actor?.department ?? null, String(session.student?.department ?? ""))) {
    return { code: 403, message: "You can only sign for your assigned department." };
  }
  if ((office === "registrar" || office === "accounting") && !(session.steps?.screening?.status === "APPROVED" && session.steps?.guidance?.status === "APPROVED" && session.steps?.clinic?.status === "APPROVED")) {
    return { code: 409, message: "Registrar and Accounting signatures unlock after the first three offices sign." };
  }
  const now = new Date().toISOString();
  session.steps[office] = {
    ...session.steps[office],
    status: "APPROVED",
    updatedBy: actor?.name ?? role,
    updatedAt: now,
    signatureImage: imageBase64,
    signatureMethod,
    signatureLabel: typeof signature.label === "string" ? signature.label.slice(0, 120) : undefined,
  };
  if (office === "guidance") session.form.status = "APPROVED";
  if (office === "screening") {
    session.screeningFeePaidAt = now;
    session.screeningFeeVerifiedBy = actor?.name ?? role;
  }
  await db.update(enrollmentSessions).set({ session, updatedAt: now }).where(eq(enrollmentSessions.studentId, studentId));
  const requestedAt = String(session.signatureRequests[office]);
  await Promise.all([
    updateOfficeSignatureNotice(studentId, String(session.student?.name ?? studentId), office, requestedAt, "signed"),
    updateStudentEnrollmentSignatureNotice(studentId, office, requestedAt, "signed"),
  ]).catch((error) => console.error("Could not update enrollment signature notifications", error));
  const allSigned = (["screening", "guidance", "clinic", "accounting", "registrar"] as SignatureOffice[]).every((key) => session.steps?.[key]?.status === "APPROVED");
  if (allSigned) {
    await notifyStudent(studentId, office, "You are officially enrolled", `All five offices signed your Study Load for ${session.form?.term ?? "this term"}.`, "success");
  }
  return { code: 200, data: { session, allSigned } };
}

// Online Clearance lives with each student's enrollment session so its status
// is shared across devices and remains tied to the registrar's student record.
const clearanceOffices = ["dean", "sao", "library", "accounting", "registrar"] as const;
type ClearanceOffice = typeof clearanceOffices[number];
const clearanceLabels: Record<ClearanceOffice, string> = { dean: "Dean", sao: "SAO / SSG Adviser", library: "Library", accounting: "Accounting", registrar: "Registrar" };
const defaultSaoEvents = [
  { title: "Brigada Balik Eskwela", attended: false },
  { title: "Foundation Day", attended: false },
  { title: "Monday – BSIT and BEED", attended: false },
  { title: "Mass – Foundation Day", attended: false },
  { title: "SSG Day Trash Galore", attended: false },
  { title: "I-CARE Seminar – Officers", attended: false },
  { title: "Exhibit (Index Card)", attended: false, note: "Pending SAO attendance verification." },
];
function initialClearance(student: Snapshot) {
  return { studentId: student.studentIdNo, studentName: student.name, section: student.section ?? "", program: student.course ?? "", yearLevel: student.yearLevel ?? "", term: "2nd Semester", academicYear: "2025-2026", offices: clearanceOffices.map((office) => ({ office, label: clearanceLabels[office], status: "not_requested" })), subjects: [], saoEvents: defaultSaoEvents.map((event) => ({ ...event })), history: [], periodOpen: true };
}
function normalizeClearance(value: Snapshot | undefined, student: Snapshot) {
  const base = initialClearance(student);
  const oldOffices = Array.isArray(value?.offices) ? value.offices as Snapshot[] : [];
  base.offices = base.offices.map((office) => {
    const saved = oldOffices.find((entry) => entry.office === office.office);
    return saved ? { ...office, ...saved, office: office.office, label: office.label } : office;
  });
  const savedEvents = Array.isArray(value?.saoEvents) && value.saoEvents.length > 0 ? value.saoEvents : base.saoEvents;
  const saoSigned = base.offices.some((office) => office.office === "sao" && office.status === "signed");
  const saoEvents = savedEvents.map((event: Snapshot) => ({ ...event, attended: saoSigned || event.attended === true }));
  return { ...base, ...(value ?? {}), offices: base.offices, saoEvents, studentId: student.studentIdNo ?? value?.studentId, studentName: student.name ?? value?.studentName, section: student.section ?? value?.section, program: student.course ?? value?.program };
}
async function clearanceRow(studentId: string) {
  const [row] = await db.select().from(enrollmentSessions).where(eq(enrollmentSessions.studentId, studentId)).limit(1);
  if (row) return row;
  const [record] = await db.select().from(masterlist).where(eq(masterlist.studentIdNo, studentId)).limit(1);
  if (!record) return null;
  const [account] = await db.select({ section: users.section }).from(users).where(eq(users.studentNumber, studentId)).limit(1);
  const session: Snapshot = { student: { studentIdNo: studentId, name: record.name, course: record.course, department: record.department, yearLevel: record.yearLevel, section: account?.section ?? "" } };
  const [created] = await db.insert(enrollmentSessions).values({ studentId, session }).onConflictDoUpdate({ target: enrollmentSessions.studentId, set: { session } }).returning();
  return created;
}
export async function getClearanceRecord(actorId: string, role: string, studentIdInput?: string) {
  const studentId = role === "STUDENT" ? await ownStudentId(actorId) : studentIdInput;
  if (!studentId) return { code: 404, message: "Student clearance record was not found." };
  if (role === "STUDENT" && studentIdInput && studentId !== studentIdInput) return { code: 403, message: "You can only access your own clearance." };
  const row = await clearanceRow(studentId);
  if (!row) return { code: 404, message: "Student clearance record was not found." };
  const session = row.session as Snapshot;
  const state = normalizeClearance(session.clearance, session.student ?? {});
  if (role === "STUDENT") await reconcileStudentClearanceNotifications(actorId, state);
  if (state.offices.some((office: Snapshot) => office.office === "sao" && office.status === "signed") && state.saoEvents.some((event: Snapshot) => event.attended !== true)) {
    session.clearance = state;
    await db.update(enrollmentSessions).set({ session, updatedAt: new Date().toISOString() }).where(eq(enrollmentSessions.studentId, studentId));
  }
  return { code: 200, data: { record: state } };
}
export async function listClearanceRecords(actorId: string, role: string) {
  const all = await db.select().from(enrollmentSessions);
  const officeByRole: Record<string, ClearanceOffice> = { DEAN: "dean", REGISTRAR: "registrar", SAO: "sao", LIBRARY: "library", ACCOUNTING: "accounting" };
  const office = officeByRole[role];
  if (office) await userRepository.ensureDemoStaffAccountsForRole(role);
  const actor = await actorRecord(actorId);
  const records = all.map((row) => { const s = row.session as Snapshot; return normalizeClearance(s.clearance, s.student ?? {}); });
  const scoped = role === "ADMIN" ? records : records.filter((r) => r.offices?.some((o: Snapshot) => o.office === office) && (role !== "DEAN" || departmentMatches(actor?.department ?? null, String(r.program ?? ""))));
  if (office) {
    for (const record of scoped) {
      const request = record.offices.find((item: Snapshot) => item.office === office && item.status === "requested");
      if (request?.requestedAt) await notifyClearanceRequestIfMissing(actorId, office, record, request.requestedAt);
    }
  }
  return { code: 200, data: { records: scoped, period: { open: true } } };
}
export async function updateClearance(actorId: string, role: string, studentId: string | null, operation: Snapshot) {
  const ownId = role === "STUDENT" ? await ownStudentId(actorId) : null;
  const targetId = ownId ?? studentId;
  if (!targetId || (ownId && studentId && ownId !== studentId)) return { code: 403, message: "This clearance action is not authorized." };
  const row = await clearanceRow(targetId);
  if (!row) return { code: 404, message: "Student clearance record was not found." };
  const session = row.session as Snapshot;
  const record = normalizeClearance(session.clearance, session.student ?? {});
  const office = operation.office as ClearanceOffice;
  if (!clearanceOffices.includes(office)) return { code: 400, message: "Unknown clearance office." };
  const current = record.offices.find((o: Snapshot) => o.office === office);
  if (role === "STUDENT") {
    if (operation.action === "request") {
      if (!record.periodOpen || current.status === "signed" || current.status === "requested") return { code: 409, message: "This request is not available." };
      Object.assign(current, { status: "requested", requestedAt: new Date().toISOString(), studentNote: operation.note });
      const [student] = await db.select({ id: users.id }).from(users).where(eq(users.studentNumber, targetId)).limit(1);
      const roleForOffice = ({ dean: "DEAN", registrar: "REGISTRAR", sao: "SAO", library: "LIBRARY", accounting: "ACCOUNTING" }[office]) as typeof users.$inferSelect.role;
      await userRepository.ensureDemoStaffAccountsForRole(roleForOffice);
      const recipients = await db.select({ id: users.id, department: users.department }).from(users).where(eq(users.role, roleForOffice));
      const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, "ADMIN"));
      const officeRecipients = office === "dean" ? recipients.filter((u) => departmentMatches(u.department, String(record.program ?? ""))) : recipients;
      if (student) {
        await Promise.all([
          ...new Set([...officeRecipients.map((u) => u.id), ...admins.map((u) => u.id)]).values(),
        ].map((id) => notify(id, office, `Clearance pending: ${clearanceLabels[office]}`, `${record.studentName} (${targetId}) has a pending clearance signature request.`, `/admin/clearance-requests?office=${office}&student=${targetId}`)));
        await notify(student.id, office, `Clearance pending: ${clearanceLabels[office]}`, `Your ${clearanceLabels[office]} clearance request was sent and is pending review.`, "/student/clearance");
      }
    } else if (operation.action === "cancel" && current.status === "requested") {
      Object.assign(current, { status: "not_requested", requestedAt: undefined });
      const roleForOffice = ({ dean: "DEAN", registrar: "REGISTRAR", sao: "SAO", library: "LIBRARY", accounting: "ACCOUNTING" }[office]) as typeof users.$inferSelect.role;
      await userRepository.ensureDemoStaffAccountsForRole(roleForOffice);
      const recipients = await db.select({ id: users.id, department: users.department }).from(users).where(eq(users.role, roleForOffice));
      const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, "ADMIN"));
      const officeRecipients = office === "dean" ? recipients.filter((u) => departmentMatches(u.department, String(record.program ?? ""))) : recipients;
      const student = await db.select({ id: users.id }).from(users).where(eq(users.studentNumber, targetId)).limit(1);
      const message = `${record.studentName} (${targetId}) cancelled the ${clearanceLabels[office]} clearance request.`;
      await Promise.all([...new Set([...officeRecipients.map((u) => u.id), ...admins.map((u) => u.id)])].map((id) => notify(id, office, "Clearance request cancelled", message, `/admin/clearance-requests?office=${office}&student=${targetId}`, "warning")));
      if (student[0]) await notify(student[0].id, office, "Clearance request cancelled", `Your ${clearanceLabels[office]} request was cancelled.`, "/student/clearance", "warning");
    }
    else return { code: 400, message: "Unsupported student action." };
  } else {
    const roleOffice: Record<string, string> = { DEAN: "dean", REGISTRAR: "registrar", SAO: "sao", LIBRARY: "library", ACCOUNTING: "accounting" };
    let requestTimestamp: string | undefined;
    if (role !== "ADMIN" && roleOffice[role] !== office) return { code: 403, message: "Your account cannot update this office." };
    if (role === "DEAN") {
      const actor = await actorRecord(actorId);
      if (!departmentMatches(actor?.department ?? null, String(record.program ?? ""))) return { code: 403, message: "You can only review students in your assigned department." };
    }
    if (operation.action === "revoke") {
      if (role !== "ADMIN" || current.status !== "signed") return { code: 409, message: "Only an administrator can revoke a completed signature." };
      requestTimestamp = current.requestedAt as string | undefined;
      Object.assign(current, { status: "requested", respondedAt: undefined, signerName: undefined, signatureImage: undefined, remarks: operation.remarks });
      if (office === "sao") record.saoEvents = record.saoEvents.map((event: Snapshot) => ({ ...event, attended: false }));
      const roleForOffice = ({ dean: "DEAN", registrar: "REGISTRAR", sao: "SAO", library: "LIBRARY", accounting: "ACCOUNTING" }[office]) as typeof users.$inferSelect.role;
      await userRepository.ensureDemoStaffAccountsForRole(roleForOffice);
      const recipients = await db.select({ id: users.id, department: users.department }).from(users).where(eq(users.role, roleForOffice));
      const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, "ADMIN"));
      const officeRecipients = office === "dean" ? recipients.filter((u) => departmentMatches(u.department, String(record.program ?? ""))) : recipients;
      await updateClearanceRequestNotifications(
        [...new Set([...officeRecipients.map((u) => u.id), ...admins.map((u) => u.id)])],
        office,
        targetId,
        String(record.studentName ?? "Student"),
        requestTimestamp,
        "pending",
      );
    } else {
      if (current.status !== "requested") return { code: 409, message: "There is no pending request for this office." };
      requestTimestamp = current.requestedAt as string | undefined;
      Object.assign(current, { status: operation.action === "sign" ? "signed" : "rejected", respondedAt: new Date().toISOString(), signerName: operation.signerName, signatureImage: operation.signatureImage, remarks: operation.remarks });
      if (office === "sao" && operation.action === "sign") record.saoEvents = record.saoEvents.map((event: Snapshot) => ({ ...event, attended: true }));
      const roleForOffice = ({ dean: "DEAN", registrar: "REGISTRAR", sao: "SAO", library: "LIBRARY", accounting: "ACCOUNTING" }[office]) as typeof users.$inferSelect.role;
      await userRepository.ensureDemoStaffAccountsForRole(roleForOffice);
      const recipients = await db.select({ id: users.id, department: users.department }).from(users).where(eq(users.role, roleForOffice));
      const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, "ADMIN"));
      const officeRecipients = office === "dean" ? recipients.filter((u) => departmentMatches(u.department, String(record.program ?? ""))) : recipients;
      await updateClearanceRequestNotifications(
        [...new Set([...officeRecipients.map((u) => u.id), ...admins.map((u) => u.id)])],
        office,
        targetId,
        String(record.studentName ?? "Student"),
        requestTimestamp,
        operation.action === "sign" ? "signed" : "rejected",
      );
    }
    if (record.offices.every((o: Snapshot) => o.status === "signed")) record.completedAt = new Date().toISOString();
    const [student] = await db.select({ id: users.id }).from(users).where(eq(users.studentNumber, targetId)).limit(1);
    if (student) {
      const resultLabel = current.status === "signed" ? "signed" : current.status === "rejected" ? "rejected" : "pending";
      const updated = await updateClearanceStudentNotification(student.id, office, requestTimestamp, resultLabel);
      if (!updated) {
        const statusText = resultLabel === "pending" ? "is pending review" : resultLabel;
        await notify(
          student.id,
          office,
          `Clearance ${resultLabel}: ${clearanceLabels[office]}`,
          `Your ${clearanceLabels[office]} clearance request ${statusText}.`,
          "/student/clearance",
          resultLabel === "signed" ? "success" : resultLabel === "rejected" ? "warning" : "info",
        );
      }
    }
  }
  session.clearance = record;
  await db.update(enrollmentSessions).set({ session, updatedAt: new Date().toISOString() }).where(eq(enrollmentSessions.studentId, targetId));
  return { code: 200, data: { record } };
}
