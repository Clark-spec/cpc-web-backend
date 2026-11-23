import { and, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/db";
import { enrollmentSessions, gradeRecords, masterlist, notifications, signatureOfficeDailyCounts, signatureQueueProcessing, users } from "@/db/schema";
import { broadcastEnrollmentQueueUpdated, broadcastNotificationCreated, broadcastNotificationUpdated } from "@/services/sse";
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

type SignatureQueueType = "study_load" | "office_signatures";
const clearanceRoleByOffice: Record<ClearanceOffice, string> = { dean: "DEAN", sao: "SAO", library: "LIBRARY", accounting: "ACCOUNTING", registrar: "REGISTRAR" };

async function clearActiveSignatureProcessing(queueType: SignatureQueueType, office: string, studentId: string) {
  await db.update(signatureQueueProcessing).set({ studentId: null, queueDate: null, queueNumber: null, startedAt: null, startedBy: null })
    .where(and(eq(signatureQueueProcessing.queueType, queueType), eq(signatureQueueProcessing.office, office), eq(signatureQueueProcessing.studentId, studentId)));
  const [student] = await db.select({ id: users.id }).from(users).where(eq(users.studentNumber, studentId)).limit(1);
  if (student) broadcastEnrollmentQueueUpdated(student.id);
}

export async function startSignatureQueueProcessing(actorId: string, role: string, queueTypeInput: unknown, officeInput: unknown, studentId: string, feePaidConfirmed = false) {
  const queueType = queueTypeInput === "study_load" || queueTypeInput === "office_signatures" ? queueTypeInput : null;
  if (!queueType) return { code: 400, message: "Unknown signature queue." };
  let queueNumber: number | undefined;
  let queueDate: string | undefined;
  let session: Snapshot | undefined;
  let office: string;
  if (queueType === "study_load") {
    const studyOffice = asOffice(officeInput);
    if (!studyOffice || !mayHandleOffice(role, studyOffice)) return { code: 403, message: "You cannot process this office queue." };
    office = studyOffice;
    const [row] = await db.select().from(enrollmentSessions).where(eq(enrollmentSessions.studentId, studentId)).limit(1);
    if (!row) return { code: 404, message: "Enrollment Study Load was not found." };
    session = row.session as Snapshot;
    if (!session.signatureRequests?.[office] || session.steps?.[office]?.status !== "PENDING") return { code: 409, message: "This request is no longer waiting in the queue." };
    const actor = await actorRecord(actorId);
    if (role === "DEAN" && !departmentMatches(actor?.department ?? null, String(session.student?.department ?? ""))) return { code: 403, message: "You can only process requests in your assigned department." };
    if (office === "screening") {
      if (!session.screeningFeePaidAt && !feePaidConfirmed) return { code: 409, message: "Confirm the ₱100 face-to-face payment before starting this request." };
      if (feePaidConfirmed) {
        session.screeningFeePaidAt = session.screeningFeePaidAt ?? new Date().toISOString();
        session.screeningFeeVerifiedBy = session.screeningFeeVerifiedBy ?? actor?.name ?? role;
        await db.update(enrollmentSessions).set({ session, updatedAt: new Date().toISOString() }).where(eq(enrollmentSessions.studentId, studentId));
        const viewers = await db.select({ id: users.id }).from(users).where(inArray(users.role, ["ADMIN", "DEAN", "GUIDANCE"]));
        viewers.forEach(({ id }) => broadcastEnrollmentQueueUpdated(id));
        const [studentUser] = await db.select({ id: users.id }).from(users).where(eq(users.studentNumber, studentId)).limit(1);
        if (studentUser) broadcastEnrollmentQueueUpdated(studentUser.id);
      }
    }
    queueNumber = Number(session.signatureQueue?.[office]?.number);
    queueDate = String(session.signatureQueue?.[office]?.date ?? "");
  } else {
    const clearanceOffice = typeof officeInput === "string" && officeInput in clearanceRoleByOffice ? officeInput as ClearanceOffice : null;
    if (!clearanceOffice || (role !== "ADMIN" && role !== clearanceRoleByOffice[clearanceOffice])) return { code: 403, message: "You cannot process this office queue." };
    office = clearanceOffice;
    const [row] = await db.select().from(enrollmentSessions).where(eq(enrollmentSessions.studentId, studentId)).limit(1);
    if (!row) return { code: 404, message: "Student clearance record was not found." };
    const state = normalizeClearance((row.session as Snapshot).clearance, (row.session as Snapshot).student ?? {});
    const actor = await actorRecord(actorId);
    if (role === "DEAN" && clearanceOffice === "dean" && !departmentMatches(actor?.department ?? null, String(state.program ?? ""))) return { code: 403, message: "You can only process requests in your assigned department." };
    const request = state.offices.find((entry: Snapshot) => entry.office === office);
    if (request?.status !== "requested") return { code: 409, message: "This request is no longer waiting in the queue." };
    queueNumber = Number(request.queueNumber);
    queueDate = String(request.queueDate ?? "");
  }
  if (!Number.isFinite(queueNumber) || !queueDate) return { code: 409, message: "This request does not have a valid queue number." };
  const queuedSessions = (await db.select({ session: enrollmentSessions.session }).from(enrollmentSessions)).map((row) => row.session as Snapshot);
  const eligibleQueue = queueType === "study_load"
    ? queuedSessions.flatMap((candidate) => {
        if (!candidate.signatureRequests?.[office] || candidate.steps?.[office]?.status !== "PENDING") return [];
        const paid = office !== "screening" || Boolean(candidate.screeningFeePaidAt) || (candidate.student?.studentIdNo === studentId && feePaidConfirmed);
        if (!paid) return [];
        const queue = candidate.signatureQueue?.[office];
        return queue ? [{ studentId: String(candidate.student?.studentIdNo ?? ""), queueNumber: Number(queue.number), queueDate: String(queue.date ?? "") }] : [];
      })
    : queuedSessions.flatMap((candidate) => {
        const record = normalizeClearance(candidate.clearance, candidate.student ?? {});
        const request = record.offices.find((entry: Snapshot) => entry.office === office && entry.status === "requested");
        return request?.queueNumber ? [{ studentId: String(record.studentId), queueNumber: Number(request.queueNumber), queueDate: String(request.queueDate ?? "") }] : [];
      });
  eligibleQueue.sort((a, b) => a.queueDate.localeCompare(b.queueDate) || a.queueNumber - b.queueNumber);
  if (eligibleQueue[0]?.studentId !== studentId) {
    const first = eligibleQueue[0];
    return { code: 409, message: first ? `Please process the earlier eligible request #${first.queueNumber} first.` : "This request is not eligible to start processing." };
  }
  const startedAt = new Date().toISOString();
  const actor = await actorRecord(actorId);
  const result = await db.transaction(async (tx) => {
    await tx.insert(signatureQueueProcessing).values({ queueType, office, studentId: null, queueDate: null, queueNumber: null }).onConflictDoNothing();
    const [active] = await tx.select().from(signatureQueueProcessing).where(and(eq(signatureQueueProcessing.queueType, queueType), eq(signatureQueueProcessing.office, office))).for("update");
    const [lockedRow] = await tx.select().from(enrollmentSessions).where(eq(enrollmentSessions.studentId, studentId)).for("update");
    if (!lockedRow) return { error: queueType === "study_load" ? "Enrollment Study Load was not found." : "Student clearance record was not found." };
    const lockedSession = lockedRow.session as Snapshot;
    if (queueType === "study_load") {
      if (!lockedSession.signatureRequests?.[office] || lockedSession.steps?.[office]?.status !== "PENDING") {
        return { error: "This request is no longer waiting in the queue." };
      }
      if (office === "screening" && !lockedSession.screeningFeePaidAt && !feePaidConfirmed) {
        return { error: "Confirm the ₱100 face-to-face payment before starting this request." };
      }
    } else {
      const record = normalizeClearance(lockedSession.clearance, lockedSession.student ?? {});
      const request = record.offices.find((entry: Snapshot) => entry.office === office);
      if (request?.status !== "requested") return { error: "This request is no longer waiting in the queue." };
    }
    if (active?.studentId) return { error: "This office is already processing another request. Please finish it first." };
    await tx.update(signatureQueueProcessing).set({ studentId, queueDate, queueNumber, startedAt, startedBy: actor?.name ?? role })
      .where(and(eq(signatureQueueProcessing.queueType, queueType), eq(signatureQueueProcessing.office, office)));
    if (queueType === "study_load" && session) await tx.update(enrollmentSessions).set({ session, updatedAt: startedAt }).where(eq(enrollmentSessions.studentId, studentId));
    return { ok: true };
  });
  if ("error" in result) return { code: 409, message: result.error };
  const roleName = queueType === "study_load" ? offices[office as SignatureOffice].role : clearanceRoleByOffice[office as ClearanceOffice];
  const viewerRoles = ["ADMIN", roleName, ...(queueType === "study_load" && office === "screening" ? ["GUIDANCE"] : [])] as typeof users.$inferSelect.role[];
  const viewers = await db.select({ id: users.id }).from(users).where(inArray(users.role, viewerRoles));
  viewers.forEach(({ id }) => broadcastEnrollmentQueueUpdated(id));
  const [student] = await db.select({ id: users.id }).from(users).where(eq(users.studentNumber, studentId)).limit(1);
  if (student) broadcastEnrollmentQueueUpdated(student.id);
  return { code: 200, data: { queueType, office, queueNumber, queueDate, startedAt } };
}

export async function finishSignatureQueueProcessing(actorId: string, role: string, queueTypeInput: unknown, officeInput: unknown, studentId: string) {
  const queueType = queueTypeInput === "study_load" || queueTypeInput === "office_signatures" ? queueTypeInput : null;
  if (!queueType) return { code: 400, message: "Unknown signature queue." };
  const office = String(officeInput ?? "");
  const authorized = queueType === "study_load"
    ? Boolean(asOffice(office) && mayHandleOffice(role, office as SignatureOffice))
    : (office in clearanceRoleByOffice && (role === "ADMIN" || role === clearanceRoleByOffice[office as ClearanceOffice]));
  if (!authorized) return { code: 403, message: "You cannot update this office queue." };
  const [active] = await db.select().from(signatureQueueProcessing).where(and(eq(signatureQueueProcessing.queueType, queueType), eq(signatureQueueProcessing.office, office))).limit(1);
  if (!active?.studentId) return { code: 409, message: "No request is currently being processed." };
  if (active.studentId !== studentId && role !== "ADMIN") return { code: 403, message: "You cannot finish another request." };
  await clearActiveSignatureProcessing(queueType, office, active.studentId);
  const roleName = queueType === "study_load" ? offices[office as SignatureOffice].role : clearanceRoleByOffice[office as ClearanceOffice];
  const viewers = await db.select({ id: users.id }).from(users).where(inArray(users.role, ["ADMIN", roleName] as typeof users.$inferSelect.role[]));
  viewers.forEach(({ id }) => broadcastEnrollmentQueueUpdated(id));
  const [student] = await db.select({ id: users.id }).from(users).where(eq(users.studentNumber, active.studentId)).limit(1);
  if (student) broadcastEnrollmentQueueUpdated(student.id);
  return { code: 200, data: { queueType, office } };
}

/** Public board payload intentionally contains queue identifiers only. */
export async function getPublicSignatureBoards() {
  const [rows, studentAccounts, processingRows] = await Promise.all([
    db.select({ studentId: enrollmentSessions.studentId, session: enrollmentSessions.session }).from(enrollmentSessions),
    db.select({ studentNumber: users.studentNumber }).from(users).where(eq(users.role, "STUDENT")),
    db.select().from(signatureQueueProcessing),
  ]);
  const accountStudentIds = new Set(studentAccounts.map((row) => String(row.studentNumber ?? "")).filter(Boolean));
  const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const orphanedSessions = rows.filter(({ studentId, session: value }) => {
    const session = value as Snapshot;
    if (accountStudentIds.has(studentId)) return false;
    const hasStudyLoadQueue = Object.entries(session.signatureRequests ?? {}).some(([office, requestedAt]) =>
      Boolean(requestedAt && session.steps?.[office]?.status === "PENDING" && session.signatureQueue?.[office]?.number),
    );
    const hasClearanceQueue = (session.clearance?.offices ?? []).some((office: Snapshot) =>
      office.status === "requested" && office.queueNumber,
    );
    return hasStudyLoadQueue || hasClearanceQueue;
  });
  const orphanedIds = new Set(orphanedSessions.map(({ studentId }) => studentId));
  const activeRows = processingRows.filter((row) => !row.studentId || accountStudentIds.has(row.studentId));

  // Reconcile work left behind if a student account was deleted before queue
  // cleanup was deployed. The board read is shared by both the preview and TV.
  if (orphanedIds.size || activeRows.length !== processingRows.length) {
    await db.transaction(async (tx) => {
      const touchedQueues = new Set<string>();
      for (const { studentId, session: value } of orphanedSessions) {
        const session = value as Snapshot;
        for (const [office, requestedAt] of Object.entries(session.signatureRequests ?? {})) {
          if (requestedAt && session.steps?.[office]?.status === "PENDING") touchedQueues.add(`study_load:${office}`);
        }
        for (const office of session.clearance?.offices ?? []) {
          if (office.status === "requested" && office.office) touchedQueues.add(`office_signatures:${office.office}`);
        }
        await tx.delete(enrollmentSessions).where(eq(enrollmentSessions.studentId, studentId));
        await tx.delete(signatureQueueProcessing).where(eq(signatureQueueProcessing.studentId, studentId));
      }
      for (const active of processingRows) {
        if (active.studentId && !accountStudentIds.has(active.studentId)) {
          touchedQueues.add(`${active.queueType}:${active.office}`);
          await tx.update(signatureQueueProcessing).set({
            studentId: null, queueDate: null, queueNumber: null, startedAt: null, startedBy: null,
          }).where(and(
            eq(signatureQueueProcessing.queueType, active.queueType),
            eq(signatureQueueProcessing.office, active.office),
            eq(signatureQueueProcessing.studentId, active.studentId),
          ));
        }
      }
      if (touchedQueues.size) {
        const remaining = (await tx.select({ session: enrollmentSessions.session }).from(enrollmentSessions))
          .map(({ session }) => session as Snapshot);
        for (const key of touchedQueues) {
          const [queueType, office] = key.split(":");
          const stillHasQueue = remaining.some((session) => queueType === "study_load"
            ? Boolean(session.signatureRequests?.[office]
              && session.steps?.[office]?.status === "PENDING"
              && session.signatureQueue?.[office]?.date === localDate)
            : (session.clearance?.offices ?? []).some((entry: Snapshot) =>
              entry.office === office && entry.status === "requested" && entry.queueDate === localDate,
            ));
          if (!stillHasQueue) {
            await tx.update(signatureOfficeDailyCounts).set({ lastQueueNumber: 0 }).where(and(
              eq(signatureOfficeDailyCounts.queueType, queueType),
              eq(signatureOfficeDailyCounts.office, office),
              eq(signatureOfficeDailyCounts.localDate, localDate),
            ));
          }
        }
      }
    });
  }
  const sessions = rows.filter(({ studentId }) => accountStudentIds.has(studentId)).map((row) => row.session as Snapshot);
  const mapQueue = (queueType: SignatureQueueType, office: string, candidates: Array<{ queueNumber: number; queueDate: string; awaitingPayment?: boolean }>) => {
    const active = activeRows.find((row) => row.queueType === queueType && row.office === office && row.studentId);
    const sorted = candidates.filter((item) => Number.isFinite(item.queueNumber)).sort((a, b) => a.queueDate.localeCompare(b.queueDate) || a.queueNumber - b.queueNumber);
    const activeIsQueued = active && sorted.some((item) => item.queueNumber === active.queueNumber && item.queueDate === active.queueDate);
    const next = sorted.filter((item) => !activeIsQueued || item.queueNumber !== active?.queueNumber || item.queueDate !== active?.queueDate).slice(0, 6);
    return {
      office,
      nowServing: active?.studentId ? { queueNumber: active.queueNumber, queueDate: active.queueDate } : null,
      startedAt: active?.startedAt ?? null,
      next,
    };
  };
  const studyOffices = (Object.keys(offices) as SignatureOffice[]).map((office) => mapQueue("study_load", office, sessions.flatMap((session) => {
    if (!session.signatureRequests?.[office] || session.steps?.[office]?.status !== "PENDING") return [];
    const queue = session.signatureQueue?.[office];
    return queue ? [{ queueNumber: Number(queue.number), queueDate: String(queue.date ?? ""), ...(office === "screening" && !session.screeningFeePaidAt ? { awaitingPayment: true } : {}) }] : [];
  })));
  const clearanceLabelsForBoard: Record<ClearanceOffice, string> = { dean: "Dean", sao: "SAO / SSG Adviser", library: "Library", accounting: "Accounting", registrar: "Registrar" };
  const clearanceOfficesForBoard = ["dean", "sao", "library", "accounting", "registrar"] as ClearanceOffice[];
  const clearanceBoards = clearanceOfficesForBoard.map((office) => {
    const board = mapQueue("office_signatures", office, sessions.flatMap((session) => {
      const record = normalizeClearance(session.clearance, session.student ?? {});
      const request = record.offices.find((entry: Snapshot) => entry.office === office && entry.status === "requested");
      return request?.queueNumber ? [{ queueNumber: Number(request.queueNumber), queueDate: String(request.queueDate ?? "") }] : [];
    }));
    return { ...board, office: clearanceLabelsForBoard[office] };
  });
  const studyLabels: Record<SignatureOffice, string> = { screening: "Dean & Screening", guidance: "Guidance", clinic: "Clinic", registrar: "Registrar", accounting: "Accounting" };
  return {
    code: 200,
    data: {
      studyLoad: studyOffices.map((board) => ({ ...board, office: studyLabels[board.office as SignatureOffice] })),
      officeSignatures: clearanceBoards,
      updatedAt: new Date().toISOString(),
    },
  };
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

const fixedBSITThirdYearLoad: Snapshot[] = [
  { id: "bsit3-im2", code: "IM 2", title: "Information Management 2", units: 3, schedule: "7:00 AM – 10:00 AM", days: "SAT", roomSetA: "LAB 1", roomSetB: "ONLINE", instructor: "E. Tajanlangit", active: true },
  { id: "bsit3-hci1", code: "HCI 1", title: "Human Computer Interaction 1", units: 3, schedule: "10:00 AM – 11:00 AM", days: "MWF", roomSetA: "LAB 2", roomSetB: "ONLINE", instructor: "I. Eda", active: true },
  { id: "bsit3-track-el2", code: "IT TRACK EL 2", title: "Fundamentals of Business Analytics", units: 3, schedule: "10:00 AM – 1:00 PM", days: "SAT", roomSetA: "TENT 2", roomSetB: "ONLINE", instructor: "A. Entrena", active: true },
  { id: "bsit3-os", code: "OS", title: "Operating System", units: 3, schedule: "12:00 PM – 1:00 PM", days: "TTh", roomSetA: "LAB 2", roomSetB: "ONLINE", instructor: "T. Comayas", active: true },
  { id: "bsit3-it-elec2", code: "IT ELEC 2", title: "Object Oriented Programming 2", units: 3, schedule: "1:00 PM – 2:00 PM", days: "MWF", roomSetA: "LAB 1", roomSetB: "ONLINE", instructor: "I. Eda", active: true },
  { id: "bsit3-soc-sci1", code: "SOC SCI 1", title: "Phil Constitution and Government", units: 3, schedule: "1:30 PM – 3:00 PM", days: "TTh", roomSetA: "302", roomSetB: "ONLINE", instructor: "J. Cadungog", active: true },
  { id: "bsit3-ias1", code: "IAS 1", title: "Information Assurance and Security 1", units: 3, schedule: "3:00 PM – 4:30 PM", days: "TTh", roomSetA: "LAB 3", roomSetB: "ONLINE", instructor: "B. Empaces", active: true },
  { id: "bsit3-appsdev", code: "APPSDEV", title: "Application Development", units: 3, schedule: "4:00 PM – 7:00 PM", days: "SAT", roomSetA: "LAB 1", roomSetB: "ONLINE", instructor: "A. Batoon", active: true },
  { id: "bsit3-net2", code: "NET 2", title: "Networking 2", units: 3, schedule: "4:30 PM – 6:00 PM", days: "TTh", roomSetA: "LAB 2", roomSetB: "ONLINE", instructor: "T. Comayas", active: true },
];

function academicYearAfter(value: string) {
  const match = value.match(/(\d{4})\s*[-–]\s*(\d{4})/);
  return match ? `${Number(match[1]) + 1}-${Number(match[2]) + 1}` : "2026-2027";
}

function nextEnrollmentPlan(record: Snapshot, section: string) {
  const normalizedDepartment = String(record.department ?? record.course ?? "").toUpperCase().replace(/[^A-Z]/g, "");
  const currentSection = section.trim().toUpperCase();
  const normalizedSection = currentSection.replace(/[^A-Z0-9]/g, "");
  const yearTwoMatch = normalizedSection.match(/^BSIT2([A-D])$/);
  const yearThreeMatch = normalizedSection.match(/^BSIT3([A-D])$/);
  const isBSIT = normalizedDepartment.includes("BSIT") || normalizedDepartment.includes("INFORMATIONTECHNOLOGY") || normalizedDepartment.includes("COMPUTERSTUDIES");
  const eligibleForThirdYearLoad = isBSIT
    && Number(record.yearLevel) === 2
    && Boolean(yearTwoMatch || yearThreeMatch);
  if (!eligibleForThirdYearLoad) {
    return { yearLevel: Number(record.yearLevel) || 1, section: currentSection, term: "2nd Semester 2025-2026", subjects: [] as Snapshot[], promote: false };
  }
  const academicYear = academicYearAfter(String(record.lastTermEnrolled ?? ""));
  return {
    yearLevel: 3,
    section: `BSIT-3${(yearTwoMatch ?? yearThreeMatch)?.[1]}`,
    term: `1st Semester ${academicYear}`,
    subjects: fixedBSITThirdYearLoad.map((subject) => ({ ...subject })),
    promote: true,
  };
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

/** Creates a missing staff/admin request alert without duplicating existing notices. */
async function ensureOfficeSignatureRequestNotices(
  office: SignatureOffice,
  department: string,
  studentId: string,
  studentName: string,
  requestedAt: string,
) {
  await userRepository.ensureDemoStaffAccountsForRole(offices[office].role);
  const recipients = await db.select({ id: users.id, department: users.department }).from(users)
    .where(eq(users.role, offices[office].role as typeof users.$inferSelect.role));
  const assigned = recipients.filter((user) => office !== "screening" || departmentMatches(user.department, department));
  const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, "ADMIN"));
  const title = `Signature Requested: ${offices[office].label}`;
  const message = `${studentName} (${studentId}) requested an enrollment signature.`;
  const href = `/admin/enrollment/clearance-requests?office=${office}`;
  await Promise.all([...new Set([...assigned.map((user) => user.id), ...admins.map((user) => user.id)])].map(async (userId) => {
    const [existing] = await db.select({ id: notifications.id }).from(notifications).where(and(
      eq(notifications.userId, userId),
      eq(notifications.officeId, office),
      eq(notifications.title, title),
      eq(notifications.message, message),
      gte(notifications.createdAt, requestedAt),
    )).limit(1);
    if (!existing) await notify(userId, office, title, message, href);
  }));
}

async function notifyStudent(studentId: string, office: SignatureOffice, title: string, message: string, type: "info" | "success" | "warning" = "info") {
  const [student] = await db.select({ id: users.id }).from(users).where(eq(users.studentNumber, studentId)).limit(1);
  if (student) await notify(student.id, office, title, message, "/student/queue", type);
}

/** Replace the original request alert with its final status for staff/admins. */
async function updateOfficeSignatureNotice(studentId: string, studentName: string, office: SignatureOffice, requestedAt: string, status: "signed" | "rejected" | "cancelled") {
  const label = offices[office].label;
  const requestedTitle = `Signature Requested: ${label}`;
  const statusTitle = `Signature Request ${status === "signed" ? "Signed" : status === "cancelled" ? "Cancelled" : "Rejected"}: ${label}`;
  const statusMessage = status === "cancelled"
    ? `${studentName} (${studentId}) cancelled their enrollment signature request.`
    : `${studentName} (${studentId}) enrollment signature request was ${status}.`;
  const messages = [
    `${studentName} (${studentId}) requested an enrollment signature.`,
    `${studentName} (${studentId}) enrollment signature request was signed.`,
    `${studentName} (${studentId}) enrollment signature request was rejected.`,
    `${studentName} (${studentId}) cancelled their enrollment signature request.`,
  ];
  const rows = await db.select({ id: notifications.id, userId: notifications.userId, title: notifications.title, message: notifications.message, read: notifications.read })
    .from(notifications)
    .where(and(
      eq(notifications.officeId, office),
      inArray(notifications.title, [
        requestedTitle,
        statusTitle,
        `Signature Signed: ${label}`,
        `Signature Rejected: ${label}`,
        `Signature Request Cancelled: ${label}`,
      ]),
      inArray(notifications.message, messages),
      gte(notifications.createdAt, requestedAt),
    ));
  const byRecipient = new Map<string, typeof rows>();
  for (const row of rows) byRecipient.set(row.userId, [...(byRecipient.get(row.userId) ?? []), row]);
  for (const [userId, recipientRows] of byRecipient) {
    const canonical = recipientRows.find((item) => item.title === requestedTitle) ?? recipientRows[0];
    const message = statusMessage;
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
async function updateStudentEnrollmentSignatureNotice(studentId: string, office: SignatureOffice, requestedAt: string, status: "signed" | "rejected" | "cancelled") {
  const [student] = await db.select({ id: users.id }).from(users).where(eq(users.studentNumber, studentId)).limit(1);
  if (!student) return;
  const label = offices[office].label;
  const requestedTitle = `Request sent to ${label}`;
  const statusTitle = `Signature Request ${status === "signed" ? "Signed" : status === "cancelled" ? "Cancelled" : "Rejected"}: ${label}`;
  const rows = await db.select({ id: notifications.id, title: notifications.title, message: notifications.message, read: notifications.read })
    .from(notifications)
    .where(and(
      eq(notifications.userId, student.id),
      eq(notifications.officeId, office),
      inArray(notifications.title, [
        requestedTitle,
        statusTitle,
        `Signature signed: ${label}`,
        `Signature rejected: ${label}`,
        `Request cancelled: ${label}`,
      ]),
      gte(notifications.createdAt, requestedAt),
    ));
  if (!rows.length) return;
  const canonical = rows.find((item) => item.title === requestedTitle) ?? rows[0];
  const message = status === "cancelled"
    ? `Your Study Load signature request to ${label} was cancelled.`
    : `Your Study Load signature request to ${label} was ${status}.`;
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
  const [record] = await db.select().from(masterlist).where(eq(masterlist.studentIdNo, studentId)).limit(1);
  if (!record) return { code: 404, message: "Student masterlist record was not found." };
  const [account] = await db.select({ section: users.section }).from(users).where(eq(users.id, actorId)).limit(1);
  if (row) {
    const existing = row.session as Snapshot;
    const currentStudent = {
      ...(existing.student ?? {}),
      studentIdNo: record.studentIdNo,
      section: existing.student?.section ?? account?.section ?? "",
      name: record.name,
      department: record.department,
      course: record.course,
      yearLevel: record.yearLevel,
      semester: record.semester,
      standing: record.standing,
      lastTermEnrolled: record.lastTermEnrolled,
      isEligible: record.isEligible,
    };
    const plan = nextEnrollmentPlan(record, String(currentStudent.section ?? ""));
    const registrarCreatedStudent = /^\d{8}$/.test(studentId) && Number(studentId) >= 20240770;
    const makeStep = (id: string, stepName: string, label: string, office: string, status: string) => ({ id, stepName, label, office, status });
    const defaultSteps = {
      verification: makeStep("step-0", "verification", "Verification & Standing", "Registrar", registrarCreatedStudent ? "APPROVED" : "PENDING"),
      clearance: makeStep("step-1", "clearance", "Online Clearance Check", "Online Clearance", registrarCreatedStudent ? "PENDING" : "LOCKED"),
      enrollment_form: makeStep("step-2", "enrollment_form", "Enrollment Form", "Student", "LOCKED"),
      screening: makeStep("step-3", "screening", "Screening Committee Approval", "Department Dean", "LOCKED"),
      guidance: makeStep("step-4", "guidance", "Guidance Office Approval", "Guidance", "LOCKED"),
      queue_ticket: makeStep("step-5", "queue_ticket", "Department Queue Number", "Registrar / Automated", "LOCKED"),
      clinic: makeStep("step-6", "clinic", "Clinic Health Assessment", "Clinic", "LOCKED"),
      accounting: makeStep("step-7", "accounting", "Accounting Fee Assessment", "Accounting", "LOCKED"),
      registrar: makeStep("step-8", "registrar", "Registrar Final Registration", "Registrar", "LOCKED"),
    };
    const form = existing.form ?? {
      id: `form-${studentId}`, studentId, studentName: record.name, department: record.department, course: record.course,
      yearLevel: plan.yearLevel, section: plan.section, term: plan.term,
      type: record.standing === "regular" ? "preprinted" : "blank", standing: record.standing,
      subjects: plan.subjects, totalUnits: plan.subjects.reduce((sum, item) => sum + Number(item.units || 0), 0), status: "DRAFT",
    };
    const clearance = normalizeClearance(existing.clearance, currentStudent);
    const clearanceComplete = clearance.offices.length === clearanceOffices.length && clearance.offices.every((office: Snapshot) => office.status === "signed");
    const mergedSteps = { ...defaultSteps, ...(existing.steps ?? {}) };
    const autoVerified = registrarCreatedStudent
      && mergedSteps.verification.status === "PENDING"
      && ["DRAFT", "RESUBMIT"].includes(String(form.status));
    if (autoVerified) {
      const verifiedAt = new Date().toISOString();
      mergedSteps.verification = { ...mergedSteps.verification, status: "APPROVED", updatedBy: "Registrar", updatedAt: verifiedAt };
      if (mergedSteps.clearance.status === "LOCKED") mergedSteps.clearance = { ...mergedSteps.clearance, status: "PENDING", updatedAt: verifiedAt };
    }
    const editableForm = ["DRAFT", "RESUBMIT"].includes(String(form.status));
    const canRepairEmptySubmittedFixedForm = plan.promote
      && form.type === "preprinted"
      && (!Array.isArray(form.subjects) || form.subjects.length === 0)
      && !Object.values(existing.signatureRequests ?? {}).some(Boolean);
    const shouldApplyThirdYearPlan = plan.promote && (editableForm || canRepairEmptySubmittedFixedForm);
    const plannedSubjects = plan.subjects;
    const nextSession: Snapshot = {
      ...existing,
      student: currentStudent,
      steps: mergedSteps,
      form: shouldApplyThirdYearPlan
        ? { ...form, yearLevel: plan.yearLevel, section: plan.section, term: plan.term, subjects: plannedSubjects, totalUnits: plannedSubjects.reduce((sum, item) => sum + Number(item.units || 0), 0) }
        : form,
      signatureRequests: existing.signatureRequests ?? {},
      clearance,
    };
    const activeStudyQueues = await db.select({ office: signatureQueueProcessing.office, studentId: signatureQueueProcessing.studentId })
      .from(signatureQueueProcessing).where(eq(signatureQueueProcessing.queueType, "study_load"));
    const signatureQueueProcessingOffices = activeStudyQueues
      .filter((active) => active.studentId === studentId)
      .map((active) => active.office);
    if (clearanceComplete) nextSession.steps.clearance = { ...nextSession.steps.clearance, status: "APPROVED", updatedAt: clearance.completedAt };
    if (!existing.steps || !existing.form || !existing.clearance || plan.promote || autoVerified) {
      await db.update(enrollmentSessions).set({ session: nextSession, updatedAt: new Date().toISOString() }).where(eq(enrollmentSessions.studentId, studentId));
    }
    return { code: 200, data: { session: { ...nextSession, signatureQueueProcessingOffices } } };
  }
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
  const plan = nextEnrollmentPlan(record, student.section);
  const makeStep = (id: string, stepName: string, label: string, office: string, status: string) => ({ id, stepName, label, office, status });
  const session: Snapshot = {
    student,
    steps: {
      verification: makeStep("step-0", "verification", "Verification & Standing", "Registrar", /^\d{8}$/.test(studentId) && Number(studentId) >= 20240770 ? "APPROVED" : "PENDING"),
      clearance: makeStep("step-1", "clearance", "Online Clearance Check", "Online Clearance", /^\d{8}$/.test(studentId) && Number(studentId) >= 20240770 ? "PENDING" : "LOCKED"),
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
      yearLevel: plan.yearLevel,
      section: plan.section,
      term: plan.term,
      type: record.standing === "regular" ? "preprinted" : "blank",
      standing: record.standing,
      subjects: plan.subjects,
      totalUnits: plan.subjects.reduce((sum, subject) => sum + Number(subject.units || 0), 0),
      status: "DRAFT",
    },
    signatureRequests: {},
    clearance: initialClearance(student),
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
  const [record] = await db.select().from(masterlist).where(eq(masterlist.studentIdNo, studentId)).limit(1);
  if (!record) return { code: 404, message: "Student masterlist record was not found." };
  const plan = nextEnrollmentPlan(record, String(session.student?.section ?? ""));
  const clearance = normalizeClearance(session.clearance, session.student ?? {});
  const clearanceComplete = clearance.offices.length === clearanceOffices.length && clearance.offices.every((office: Snapshot) => office.status === "signed");
  if (!clearanceComplete) return { code: 409, message: "Complete all five Online Clearance signatures before saving the Study Load." };
  if (!session?.steps?.verification || session.steps.verification.status !== "APPROVED") {
    return { code: 409, message: "Confirm your Registrar record before editing the Study Load." };
  }
  if (!["DRAFT", "RESUBMIT"].includes(String(session.form?.status))) {
    return { code: 409, message: "The submitted Study Load can no longer be edited." };
  }
  const submittedSubjects = input && typeof input === "object" && Array.isArray((input as Snapshot).subjects)
    ? (input as Snapshot).subjects as Snapshot[]
    : null;
  if (!submittedSubjects || submittedSubjects.length > 24) return { code: 400, message: "Provide a valid Study Load with no more than 24 subjects." };
  const subjects = plan.promote ? plan.subjects : submittedSubjects;
  for (const subject of subjects) {
    if (typeof subject.code !== "string" || !subject.code.trim() || typeof subject.title !== "string" || !subject.title.trim() || !Number.isFinite(Number(subject.units)) || Number(subject.units) <= 0) {
      return { code: 400, message: "Each subject needs a code, title, and valid unit count." };
    }
  }
  const totalUnits = subjects.reduce((sum, subject) => sum + Number(subject.units), 0);
  const maximumUnits = session.form.standing === "regular" ? 27 : 24;
  if (totalUnits > maximumUnits) return { code: 400, message: `The Study Load cannot exceed ${maximumUnits} units.` };
  session.form = { ...session.form, yearLevel: plan.yearLevel, section: plan.section, term: plan.term, subjects, totalUnits };
  if (clearanceComplete) {
    session.steps.clearance = { ...session.steps.clearance, status: "APPROVED", updatedAt: new Date().toISOString() };
    session.steps.enrollment_form = { ...session.steps.enrollment_form, status: "PENDING" };
  }
  session.clearance = clearance;
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
    if (!session?.signatureRequests?.[office]) return false;
    return role !== "DEAN" || departmentMatches(actor?.department ?? null, String(session.student?.department ?? ""));
  });
  sessions.sort((left, right) => {
    if (office === "screening") {
      const leftPaid = Boolean(left.screeningFeePaidAt);
      const rightPaid = Boolean(right.screeningFeePaidAt);
      if (leftPaid !== rightPaid) return leftPaid ? -1 : 1;
    }
    const leftRequestedAt = String(left.signatureRequests[office]);
    const rightRequestedAt = String(right.signatureRequests[office]);
    const leftQueueDate = String(left.signatureQueue?.[office]?.date ?? leftRequestedAt.slice(0, 10));
    const rightQueueDate = String(right.signatureQueue?.[office]?.date ?? rightRequestedAt.slice(0, 10));
    const leftQueue = Number(left.signatureQueue?.[office]?.number ?? Number.MAX_SAFE_INTEGER);
    const rightQueue = Number(right.signatureQueue?.[office]?.number ?? Number.MAX_SAFE_INTEGER);
    return leftQueueDate.localeCompare(rightQueueDate) || leftQueue - rightQueue || Date.parse(leftRequestedAt) - Date.parse(rightRequestedAt);
  });
  await Promise.all(sessions.filter((session) => session.steps?.[office]?.status === "PENDING").map((session) => ensureOfficeSignatureRequestNotices(
    office,
    String(session.student?.department ?? ""),
    String(session.student?.studentIdNo ?? ""),
    String(session.student?.name ?? session.student?.studentIdNo ?? "Student"),
    String(session.signatureRequests[office]),
  ).catch((error) => console.error("Could not ensure office signature notification", error))));
  const [processing] = await db.select().from(signatureQueueProcessing).where(and(eq(signatureQueueProcessing.queueType, "study_load"), eq(signatureQueueProcessing.office, office))).limit(1);
  const sessionsWithProcessing = sessions.map((session) => ({
    ...session,
    signatureQueueProcessing: processing?.studentId === session.student?.studentIdNo
      ? { startedAt: processing.startedAt, startedBy: processing.startedBy }
      : undefined,
  }));
  return { code: 200, data: { sessions: sessionsWithProcessing } };
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
  const plan = nextEnrollmentPlan(record, account?.section || String(savedSession.student?.section ?? ""));
  if (savedSession.steps?.verification?.status !== "APPROVED") return { code: 409, message: "Confirm your Registrar record before submitting the Study Load." };
  const clearance = normalizeClearance(savedSession.clearance, savedSession.student ?? {});
  if (clearance.offices.length !== clearanceOffices.length || !clearance.offices.every((office: Snapshot) => office.status === "signed")) {
    return { code: 409, message: "Complete all five Online Clearance signatures before submitting the Study Load." };
  }
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
      yearLevel: plan.yearLevel,
      section: plan.section,
      term: plan.term,
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
  const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const result = await db.transaction(async (tx) => {
    await tx.insert(signatureOfficeDailyCounts).values({ queueType: "study_load", office, localDate, requestCount: 0 }).onConflictDoNothing();
    const [counter] = await tx.select().from(signatureOfficeDailyCounts).where(and(
      eq(signatureOfficeDailyCounts.queueType, "study_load"),
      eq(signatureOfficeDailyCounts.office, office),
      eq(signatureOfficeDailyCounts.localDate, localDate),
    )).for("update");
    if ((counter?.requestCount ?? 0) >= 1000) return { error: "Today’s signature request limit is full. Please try again tomorrow." };
    const [row] = await tx.select().from(enrollmentSessions).where(eq(enrollmentSessions.studentId, studentId)).limit(1);
    if (!row) return { error: "Submit your Study Load before requesting signatures.", code: 404 };
    const session = row.session as Snapshot;
    const signed = (key: string) => session.steps?.[key]?.status === "APPROVED";
    const formReady = ["SUBMITTED", "APPROVED"].includes(String(session.form?.status));
    const firstThreeSigned = signed("screening") && signed("guidance") && signed("clinic");
    const available = office === "screening" || office === "guidance" || office === "clinic"
      ? formReady && !signed(office)
      : firstThreeSigned && !signed(office);
    if (!available) return { error: "This signature request is not available yet.", code: 409 };
    if (session.signatureRequests?.[office] && session.steps?.[office]?.status !== "RESUBMIT") return { error: "You already sent a request to this office.", code: 409 };
    const now = new Date().toISOString();
    const requestCount = counter?.requestCount ?? 0;
    const queueNumber = (counter?.lastQueueNumber ?? 0) + 1;
    session.signatureRequests = { ...session.signatureRequests, [office]: now };
    session.signatureQueue = { ...session.signatureQueue, [office]: { date: localDate, number: queueNumber } };
    session.steps[office] = { ...session.steps[office], status: "PENDING" };
    await tx.update(signatureOfficeDailyCounts).set({ requestCount: requestCount + 1, lastQueueNumber: queueNumber }).where(and(
      eq(signatureOfficeDailyCounts.queueType, "study_load"),
      eq(signatureOfficeDailyCounts.office, office),
      eq(signatureOfficeDailyCounts.localDate, localDate),
    ));
    await tx.update(enrollmentSessions).set({ session, updatedAt: now }).where(eq(enrollmentSessions.studentId, studentId));
    return { session, now, queueNumber };
  });
  if ("error" in result) return { code: result.code ?? 409, message: result.error };
  const { session, now, queueNumber } = result;
  const fullName = String(session.student?.name ?? studentId);
  await Promise.all([
    ensureOfficeSignatureRequestNotices(office, String(session.student?.department ?? ""), studentId, fullName, now),
    notifyStudent(studentId, office, `Request sent to ${offices[office].label}`, `Your Study Load signature request was sent to ${offices[office].label}.`, "success"),
  ]).catch((error) => console.error("Enrollment signature request saved, but a notification could not be delivered", error));
  return { code: 200, data: { session, queueNumber, dailyLimit: 1000 } };
}

export async function cancelOfficeSignatureRequest(actorId: string, studentIdInput: string, officeInput: unknown) {
  const studentId = await ownStudentId(actorId);
  const office = asOffice(officeInput);
  if (!studentId || studentId !== studentIdInput || !office) return { code: 403, message: "This signature cancellation is not authorized." };
  const result = await db.transaction(async (tx) => {
    await tx.insert(signatureQueueProcessing).values({ queueType: "study_load", office, studentId: null, queueDate: null, queueNumber: null }).onConflictDoNothing();
    const [active] = await tx.select().from(signatureQueueProcessing).where(and(
      eq(signatureQueueProcessing.queueType, "study_load"),
      eq(signatureQueueProcessing.office, office),
    )).for("update");
    if (active?.studentId === studentId) return { error: "The office has started processing this request, so it can no longer be cancelled. Please contact the office." };
    const [row] = await tx.select().from(enrollmentSessions).where(eq(enrollmentSessions.studentId, studentId)).for("update");
    if (!row) return { error: "Enrollment Study Load was not found.", code: 404 };
    const session = row.session as Snapshot;
    if (!session.signatureRequests?.[office] || session.steps?.[office]?.status === "APPROVED") {
      return { error: "There is no cancellable signature request for this office." };
    }
    const requestedAt = session.signatureRequests[office] as string;
    const now = new Date().toISOString();
    const requests = { ...session.signatureRequests };
    delete requests[office];
    session.signatureRequests = requests;
    session.steps[office] = { ...session.steps[office], status: "PENDING", respondedAt: undefined, updatedAt: now };
    await tx.update(enrollmentSessions).set({ session, updatedAt: now }).where(eq(enrollmentSessions.studentId, studentId));
    return { session, requestedAt, now };
  });
  if ("error" in result) return { code: result.code ?? 409, message: result.error };
  const { session, requestedAt, now } = result;
  const [student] = await db.select({ id: users.id }).from(users).where(eq(users.studentNumber, studentId)).limit(1);
  if (student) broadcastEnrollmentQueueUpdated(student.id);
  const fullName = String(session.student?.name ?? studentId);
  await Promise.all([
    updateOfficeSignatureNotice(studentId, fullName, office, requestedAt, "cancelled"),
    updateStudentEnrollmentSignatureNotice(studentId, office, requestedAt, "cancelled"),
  ]).catch((error) => console.error("Could not update enrollment signature cancellation notifications", error));
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
  if (session.steps?.[office]?.status === "APPROVED") return { code: 409, message: "This office has already signed the Study Load." };
  const [activeProcessing] = await db.select().from(signatureQueueProcessing).where(and(eq(signatureQueueProcessing.queueType, "study_load"), eq(signatureQueueProcessing.office, office))).limit(1);
  if (activeProcessing?.studentId !== studentId) return { code: 409, message: "Start processing this request before signing it." };
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
  const requestedAt = String(session.signatureRequests[office]);
  await Promise.all([
    updateOfficeSignatureNotice(studentId, String(session.student?.name ?? studentId), office, requestedAt, "signed"),
    updateStudentEnrollmentSignatureNotice(studentId, office, requestedAt, "signed"),
  ]).catch((error) => console.error("Could not update enrollment signature notifications", error));
  const allSigned = (["screening", "guidance", "clinic", "accounting", "registrar"] as SignatureOffice[]).every((key) => session.steps?.[key]?.status === "APPROVED");
  if (allSigned) {
    const [record] = await db.select().from(masterlist).where(eq(masterlist.studentIdNo, studentId)).limit(1);
    if (record) {
      const [account] = await db.select({ section: users.section }).from(users).where(eq(users.studentNumber, studentId)).limit(1);
      const plan = nextEnrollmentPlan(record, String(account?.section ?? session.student?.section ?? ""));
      if (plan.promote) {
        session.student = {
          ...session.student,
          section: plan.section,
          yearLevel: plan.yearLevel,
          semester: 1,
          lastTermEnrolled: plan.term,
        };
        session.form = { ...session.form, section: plan.section, yearLevel: plan.yearLevel, term: plan.term, status: "APPROVED" };
        await db.transaction(async (tx) => {
          await tx.update(masterlist).set({ yearLevel: plan.yearLevel, semester: 1, lastTermEnrolled: plan.term, isEligible: true }).where(eq(masterlist.studentIdNo, studentId));
          await tx.update(users).set({ section: plan.section, yearLevel: plan.yearLevel, course: record.course, department: record.department }).where(eq(users.studentNumber, studentId));
          await tx.update(enrollmentSessions).set({ session, updatedAt: now }).where(eq(enrollmentSessions.studentId, studentId));
        });
      } else {
        await db.update(enrollmentSessions).set({ session, updatedAt: now }).where(eq(enrollmentSessions.studentId, studentId));
      }
    } else {
      await db.update(enrollmentSessions).set({ session, updatedAt: now }).where(eq(enrollmentSessions.studentId, studentId));
    }
    await notifyStudent(studentId, office, "You are officially enrolled", `All five offices signed your Study Load for ${session.form?.term ?? "this term"}.`, "success");
  } else {
    await db.update(enrollmentSessions).set({ session, updatedAt: now }).where(eq(enrollmentSessions.studentId, studentId));
  }
  await clearActiveSignatureProcessing("study_load", office, studentId);
  if (office === "screening") {
    const queueViewers = await db.select({ id: users.id }).from(users).where(inArray(users.role, ["ADMIN", "DEAN", "GUIDANCE"]));
    queueViewers.forEach(({ id }) => broadcastEnrollmentQueueUpdated(id));
  }
  return { code: 200, data: { session, allSigned } };
}

// Online Clearance lives with each student's enrollment session so its status
// is shared across devices and remains tied to the registrar's student record.
const clearanceOffices = ["dean", "sao", "library", "accounting", "registrar"] as const;
type ClearanceOffice = typeof clearanceOffices[number];
const clearanceLabels: Record<ClearanceOffice, string> = { dean: "Dean", sao: "SAO / SSG Adviser", library: "Library", accounting: "Accounting", registrar: "Registrar" };
const BSIT_2A_GRADE_TERM = "2nd Semester · AY 2025-2026";
const BSIT_2A_GRADE_CODES = ["F3-DANCE", "F3-READING-VISUAL-ARTS", "F3-SCIENCE-TECHNOLOGY-SOCIETY", "F3-INFORMATION-MANAGEMENT", "F3-IT-TRACK-ELECTIVE-1", "F3-OBJECT-ORIENTED-PROGRAMMING", "F3-PROBABILITIES-STATISTICS", "F3-DATA-COMMUNICATIONS-NETWORKING-1", "F3-QUANTITATIVE-METHODS"];
function matchesB2A(section: string | null | undefined) { return String(section ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "") === "BSIT2A"; }
const defaultSaoEventTitles = [
  "Brigada Balik Eskwela",
  "Foundation Day",
  "Monday – BSIT and BEED",
  "Mass – Foundation Day",
  "SSG Day Trash Galore",
  "I-CARE Seminar – Officers",
  "Exhibit (Index Card)",
];
function defaultSaoEvents(studentId: string) {
  let seed = 0;
  for (const character of studentId) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619);
  return defaultSaoEventTitles.map((title, index) => {
    seed = Math.imul(seed ^ (index + 1), 16777619) >>> 0;
    const status = (["pending", "attended", "not_attended"] as const)[seed % 3];
    return {
      title,
      status,
      ...(status === "pending" ? { note: "Awaiting SAO attendance verification." } : {}),
      ...(status === "not_attended" ? { note: "Please contact the SAO for attendance guidance." } : {}),
    };
  });
}
function initialClearance(student: Snapshot) {
  return { studentId: student.studentIdNo, studentName: student.name, section: student.section ?? "", program: student.course ?? "", yearLevel: student.yearLevel ?? "", term: "2nd Semester", academicYear: "2025-2026", offices: clearanceOffices.map((office) => ({ office, label: clearanceLabels[office], status: "not_requested" })), subjects: [], saoEvents: defaultSaoEvents(String(student.studentIdNo ?? "")), history: [], periodOpen: true };
}
function normalizeClearance(value: Snapshot | undefined, student: Snapshot) {
  const base = initialClearance(student);
  const oldOffices = Array.isArray(value?.offices) ? value.offices as Snapshot[] : [];
  base.offices = base.offices.map((office) => {
    const saved = oldOffices.find((entry) => entry.office === office.office);
    return saved ? { ...office, ...saved, office: office.office, label: office.label } : office;
  });
  const savedEvents = Array.isArray(value?.saoEvents) && value.saoEvents.length > 0 ? value.saoEvents : base.saoEvents;
  const saoEvents = base.saoEvents.map((defaultEvent: Snapshot) => {
    const event = savedEvents.find((saved: Snapshot) => saved.title === defaultEvent.title) as Snapshot | undefined;
    if (!event) return defaultEvent;
    const status = ["pending", "attended", "not_attended"].includes(String(event.status))
      ? event.status
      : event.attended === true ? "attended" : event.attended === false ? "pending" : defaultEvent.status;
    return {
      ...defaultEvent,
      ...event,
      status,
      note: typeof event.note === "string" ? event.note.slice(0, 500) : defaultEvent.note,
    };
  });
  const allSigned = base.offices.length === clearanceOffices.length && base.offices.every((office) => office.status === "signed");
  return {
    ...base,
    ...(value ?? {}),
    offices: base.offices,
    saoEvents,
    studentId: value?.studentId ?? student.studentIdNo,
    studentName: value?.studentName ?? student.name,
    section: value?.section ?? student.section,
    program: value?.program ?? student.course,
    yearLevel: value?.yearLevel ?? student.yearLevel,
    history: Array.isArray(value?.history) ? value.history : [],
    ...(allSigned && !value?.completedAt ? { completedAt: base.offices.map((office) => office.respondedAt).filter(Boolean).sort().at(-1) } : {}),
  };
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
  if (role === "STUDENT") {
    const activeRows = await db.select({ office: signatureQueueProcessing.office, studentId: signatureQueueProcessing.studentId })
      .from(signatureQueueProcessing).where(eq(signatureQueueProcessing.queueType, "office_signatures"));
    for (const officeRecord of state.offices as Snapshot[]) {
      officeRecord.isProcessing = activeRows.some((active) => active.office === officeRecord.office && active.studentId === studentId);
    }
  }
  if (role === "STUDENT") await reconcileStudentClearanceNotifications(actorId, state);
  return { code: 200, data: { record: state } };
}
export async function listClearanceRecords(actorId: string, role: string) {
  if (role === "SAO") {
    const students = await db.select({ studentIdNo: masterlist.studentIdNo }).from(masterlist);
    for (const student of students) await clearanceRow(String(student.studentIdNo));
  }
  const all = await db.select().from(enrollmentSessions);
  const officeByRole: Record<string, ClearanceOffice> = { DEAN: "dean", REGISTRAR: "registrar", SAO: "sao", LIBRARY: "library", ACCOUNTING: "accounting" };
  const office = officeByRole[role];
  if (office) await userRepository.ensureDemoStaffAccountsForRole(role);
  const actor = await actorRecord(actorId);
  const records = all.map((row) => { const s = row.session as Snapshot; return normalizeClearance(s.clearance, s.student ?? {}); });
  const processingRows = await db.select().from(signatureQueueProcessing).where(eq(signatureQueueProcessing.queueType, "office_signatures"));
  for (const record of records) {
    for (const officeRecord of record.offices as Snapshot[]) {
      const processing = processingRows.find((entry) => entry.office === officeRecord.office && entry.studentId === record.studentId);
      officeRecord.isProcessing = Boolean(processing);
      if (processing) {
        officeRecord.processingAt = processing.startedAt;
        officeRecord.processingBy = processing.startedBy;
      }
    }
  }
  const scoped = role === "ADMIN" ? records : records.filter((r) => r.offices?.some((o: Snapshot) => o.office === office) && (role !== "DEAN" || departmentMatches(actor?.department ?? null, String(r.program ?? ""))));
  if (office) {
    for (const record of scoped) {
      const request = record.offices.find((item: Snapshot) => item.office === office && item.status === "requested");
      if (request?.requestedAt) await notifyClearanceRequestIfMissing(actorId, office, record, request.requestedAt);
    }
  }
  return { code: 200, data: { records: scoped, period: { open: true } } };
}

export async function requestClearanceSignatures(actorId: string, officeInputs: unknown, note?: unknown) {
  const studentId = await ownStudentId(actorId);
  if (!studentId || !Array.isArray(officeInputs) || officeInputs.length === 0) {
    return { code: 400, message: "Select at least one Office Signature request." };
  }
  const offices = [...new Set(officeInputs)].filter((value): value is ClearanceOffice => clearanceOffices.includes(value as ClearanceOffice));
  if (offices.length !== officeInputs.length) return { code: 400, message: "One or more Office Signature requests are invalid." };
  const row = await clearanceRow(studentId);
  if (!row) return { code: 404, message: "Student clearance record was not found." };
  const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const result = await db.transaction(async (tx) => {
    const countsByOffice: Partial<Record<ClearanceOffice, number>> = {};
    const queueNumbersByOffice: Partial<Record<ClearanceOffice, number>> = {};
    for (const office of [...offices].sort()) {
      await tx.insert(signatureOfficeDailyCounts).values({ queueType: "office_signatures", office, localDate, requestCount: 0 }).onConflictDoNothing();
      const [counter] = await tx.select().from(signatureOfficeDailyCounts).where(and(
        eq(signatureOfficeDailyCounts.queueType, "office_signatures"),
        eq(signatureOfficeDailyCounts.office, office),
        eq(signatureOfficeDailyCounts.localDate, localDate),
      )).for("update");
      const count = counter?.requestCount ?? 0;
      if (count >= 1000) return { error: `${clearanceLabels[office]} has reached its 1,000 request limit for today. Please try again tomorrow.` };
      countsByOffice[office] = count;
      queueNumbersByOffice[office] = (counter?.lastQueueNumber ?? 0) + 1;
    }
    const [lockedRow] = await tx.select().from(enrollmentSessions).where(eq(enrollmentSessions.studentId, studentId)).for("update");
    if (!lockedRow) return { error: "Student clearance record was not found.", code: 404 };
    const session = lockedRow.session as Snapshot;
    const record = normalizeClearance(session.clearance, session.student ?? {});
    if (!record.periodOpen) return { error: "The Office Signatures request period is closed." };
    if (offices.includes("registrar")) {
      const requiredPriorOffices = record.offices.filter((entry: Snapshot) => entry.office !== "registrar");
      if (requiredPriorOffices.length !== 4 || requiredPriorOffices.some((entry: Snapshot) => entry.status !== "signed")) {
        return { error: "The Registrar clearance request is available after Dean, SAO / SSG Adviser, Library, and Accounting have signed." };
      }
      const [studentAccount] = await tx.select({ section: users.section }).from(users).where(eq(users.studentNumber, studentId)).limit(1);
      const section = studentAccount?.section ?? record.section ?? "";
      const term = matchesB2A(section) ? BSIT_2A_GRADE_TERM : "1st Semester · AY 2026-2027";
      const grades = await tx.select({ subjectCode: gradeRecords.subjectCode, grade: gradeRecords.grade, acknowledgedAt: gradeRecords.acknowledgedAt })
        .from(gradeRecords).where(and(eq(gradeRecords.studentUserId, actorId), eq(gradeRecords.term, term)));
      if (matchesB2A(section)) {
        const byCode = new Map(grades.map((grade) => [grade.subjectCode, grade]));
        if (BSIT_2A_GRADE_CODES.some((code) => !byCode.get(code)?.grade || !byCode.get(code)?.acknowledgedAt)) {
          return { error: "The Registrar clearance request is available after all nine BSIT-2A Form 3 grades are posted and acknowledged." };
        }
      } else {
        const postedGrades = grades.filter((grade) => Boolean(grade.grade));
        if (!postedGrades.length || postedGrades.some((grade) => !grade.acknowledgedAt)) {
          return { error: "The Registrar clearance request is available after your grades are posted and acknowledged." };
        }
      }
    }
    const selected = offices.map((office) => record.offices.find((entry: Snapshot) => entry.office === office) as Snapshot);
    if (selected.some((entry) => !entry || entry.status === "signed" || entry.status === "requested")) {
      return { error: "One or more selected Office Signature requests are no longer available." };
    }
    const requestedAt = new Date().toISOString();
    selected.forEach((entry) => Object.assign(entry, {
      status: "requested",
      requestedAt,
      studentNote: typeof note === "string" ? note.trim().slice(0, 1000) : undefined,
      queueDate: localDate,
      queueNumber: queueNumbersByOffice[entry.office as ClearanceOffice] ?? 1,
    }));
    session.clearance = record;
    for (const office of offices) {
      await tx.update(signatureOfficeDailyCounts).set({
        requestCount: (countsByOffice[office] ?? 0) + 1,
        lastQueueNumber: queueNumbersByOffice[office] ?? 1,
      }).where(and(
        eq(signatureOfficeDailyCounts.queueType, "office_signatures"),
        eq(signatureOfficeDailyCounts.office, office),
        eq(signatureOfficeDailyCounts.localDate, localDate),
      ));
    }
    await tx.update(enrollmentSessions).set({ session, updatedAt: requestedAt }).where(eq(enrollmentSessions.studentId, studentId));
    return { record, requestedAt };
  });
  if ("error" in result) return { code: result.code ?? 409, message: result.error };

  const [student] = await db.select({ id: users.id }).from(users).where(eq(users.studentNumber, studentId)).limit(1);
  if (student) {
    await Promise.all(offices.map(async (office) => {
      const roleForOffice = ({ dean: "DEAN", registrar: "REGISTRAR", sao: "SAO", library: "LIBRARY", accounting: "ACCOUNTING" }[office]) as typeof users.$inferSelect.role;
      await userRepository.ensureDemoStaffAccountsForRole(roleForOffice);
      const recipients = await db.select({ id: users.id, department: users.department }).from(users).where(eq(users.role, roleForOffice));
      const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, "ADMIN"));
      const officeRecipients = office === "dean" ? recipients.filter((user) => departmentMatches(user.department, String(result.record.program ?? ""))) : recipients;
      await Promise.all([...new Set([...officeRecipients.map((user) => user.id), ...admins.map((user) => user.id)])]
        .map((id) => notify(id, office, `Clearance pending: ${clearanceLabels[office]}`, `${result.record.studentName} (${studentId}) has a pending clearance signature request.`, `/admin/clearance-requests?office=${office}&student=${studentId}`)));
      await notify(student.id, office, `Clearance pending: ${clearanceLabels[office]}`, `Your ${clearanceLabels[office]} clearance request was sent and is pending review.`, "/student/clearance");
    }));
  }
  return { code: 200, data: { record: result.record } };
}

export async function updateClearance(actorId: string, role: string, studentId: string | null, operation: Snapshot) {
  if (role === "STUDENT" && operation.action === "request") {
    return requestClearanceSignatures(actorId, [operation.office], operation.note);
  }
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
  if (operation.action === "update_sao_events") {
    if (office !== "sao" || (role !== "SAO" && role !== "ADMIN")) return { code: 403, message: "Only the SAO can update activity attendance." };
    if (current.status === "not_requested") return { code: 409, message: "The student must request the SAO clearance signature first." };
    if (!Array.isArray(operation.events) || operation.events.length !== defaultSaoEventTitles.length) {
      return { code: 400, message: "Submit an attendance status for every SAO activity." };
    }
    const byTitle = new Map((operation.events as Snapshot[]).map((event) => [String(event.title ?? ""), event]));
    if (defaultSaoEventTitles.some((title) => !byTitle.has(title))) return { code: 400, message: "One or more SAO activities are invalid." };
    const allowedStatuses = ["pending", "attended", "not_attended"];
    if ((operation.events as Snapshot[]).some((event) => !allowedStatuses.includes(String(event.status ?? "")))) {
      return { code: 400, message: "One or more SAO attendance statuses are invalid." };
    }
    const events = defaultSaoEventTitles.map((title) => {
      const event = byTitle.get(title) as Snapshot;
      const status = String(event.status ?? "");
      const note = typeof event.note === "string" ? event.note.trim().slice(0, 500) : "";
      return { title, status, ...(note ? { note } : {}) };
    });
    record.saoEvents = events;
    session.clearance = record;
    await db.update(enrollmentSessions).set({ session, updatedAt: new Date().toISOString() }).where(eq(enrollmentSessions.studentId, targetId));
    const [student] = await db.select({ id: users.id }).from(users).where(eq(users.studentNumber, targetId)).limit(1);
    if (student) broadcastEnrollmentQueueUpdated(student.id);
    return { code: 200, data: { record } };
  }
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
    } else if (operation.action === "cancel") {
      const cancelled = await db.transaction(async (tx) => {
        await tx.insert(signatureQueueProcessing).values({ queueType: "office_signatures", office, studentId: null, queueDate: null, queueNumber: null }).onConflictDoNothing();
        const [active] = await tx.select().from(signatureQueueProcessing).where(and(
          eq(signatureQueueProcessing.queueType, "office_signatures"),
          eq(signatureQueueProcessing.office, office),
        )).for("update");
        if (active?.studentId === targetId) return { error: "The office has started processing this request, so it can no longer be cancelled. Please contact the office." };
        const [lockedRow] = await tx.select().from(enrollmentSessions).where(eq(enrollmentSessions.studentId, targetId)).for("update");
        if (!lockedRow) return { error: "Student clearance record was not found.", code: 404 };
        const lockedSession = lockedRow.session as Snapshot;
        const lockedRecord = normalizeClearance(lockedSession.clearance, lockedSession.student ?? {});
        const lockedOffice = lockedRecord.offices.find((entry: Snapshot) => entry.office === office);
        if (lockedOffice?.status !== "requested") return { error: "There is no cancellable request for this office." };
        const requestedAt = lockedOffice.requestedAt as string | undefined;
        Object.assign(lockedOffice, { status: "not_requested", requestedAt: undefined });
        lockedSession.clearance = lockedRecord;
        const now = new Date().toISOString();
        await tx.update(enrollmentSessions).set({ session: lockedSession, updatedAt: now }).where(eq(enrollmentSessions.studentId, targetId));
        return { record: lockedRecord, requestedAt };
      });
      if ("error" in cancelled) return { code: cancelled.code ?? 409, message: cancelled.error };
      const roleForOffice = ({ dean: "DEAN", registrar: "REGISTRAR", sao: "SAO", library: "LIBRARY", accounting: "ACCOUNTING" }[office]) as typeof users.$inferSelect.role;
      await userRepository.ensureDemoStaffAccountsForRole(roleForOffice);
      const recipients = await db.select({ id: users.id, department: users.department }).from(users).where(eq(users.role, roleForOffice));
      const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, "ADMIN"));
      const officeRecipients = office === "dean" ? recipients.filter((u) => departmentMatches(u.department, String(cancelled.record.program ?? ""))) : recipients;
      const [student] = await db.select({ id: users.id }).from(users).where(eq(users.studentNumber, targetId)).limit(1);
      const message = `${cancelled.record.studentName} (${targetId}) cancelled the ${clearanceLabels[office]} clearance request.`;
      await Promise.all([...new Set([...officeRecipients.map((u) => u.id), ...admins.map((u) => u.id)])].map((id) => notify(id, office, "Clearance request cancelled", message, `/admin/clearance-requests?office=${office}&student=${targetId}`, "warning")));
      if (student) {
        broadcastEnrollmentQueueUpdated(student.id);
        await notify(student.id, office, "Clearance request cancelled", `Your ${clearanceLabels[office]} request was cancelled.`, "/student/clearance", "warning");
      }
      return { code: 200, data: { record: cancelled.record } };
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
    if (operation.action === "sign" || operation.action === "reject") {
      const [active] = await db.select().from(signatureQueueProcessing).where(and(eq(signatureQueueProcessing.queueType, "office_signatures"), eq(signatureQueueProcessing.office, office))).limit(1);
      if (active?.studentId && active.studentId !== targetId) return { code: 409, message: "Finish the request currently shown on the live board before handling another one." };
      if (operation.action === "sign" && active?.studentId !== targetId) {
        return { code: 409, message: "Start processing this request before reviewing and signing it." };
      }
      if (operation.action === "reject" && !active?.studentId) {
        const started = await startSignatureQueueProcessing(actorId, role, "office_signatures", office, targetId);
        if (started.code >= 400) return started;
      }
    }
    if (operation.action === "revoke") {
      if (role !== "ADMIN" || current.status !== "signed") return { code: 409, message: "Only an administrator can revoke a completed signature." };
      requestTimestamp = current.requestedAt as string | undefined;
      Object.assign(current, { status: "requested", respondedAt: undefined, signerName: undefined, signatureImage: undefined, remarks: operation.remarks });
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
    if (record.offices.every((o: Snapshot) => o.status === "signed")) {
      if (!record.completedAt) record.completedAt = new Date().toISOString();
      const history = Array.isArray(record.history) ? record.history as Snapshot[] : [];
      if (!history.some((entry) => entry.academicYear === record.academicYear && entry.semester === record.term)) {
        record.history = [...history, {
          academicYear: record.academicYear,
          semester: record.term,
          status: "Cleared",
          dateCleared: record.completedAt,
          section: record.section,
          program: record.program,
          yearLevel: record.yearLevel,
          signatures: record.offices,
        }];
      }
      session.steps = {
        ...session.steps,
        clearance: { ...session.steps?.clearance, status: "APPROVED", updatedAt: record.completedAt },
      };
    }
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
  if (["sign", "reject", "cancel", "revoke"].includes(String(operation.action))) {
    await clearActiveSignatureProcessing("office_signatures", office, targetId);
  }
  return { code: 200, data: { record } };
}

