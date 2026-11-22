import type { Request, Response } from "express";
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { gradeRecords, users } from "@/db/schema";
import type { AuthenticatedRequest } from "@/middlewares/auth-middleware";
import { NotificationRepository } from "@/repositories/notification-repository";
import { memUsers, UserRepository } from "@/repositories/user-repository";
import { broadcastNotificationCreated, broadcastNotificationUpdated } from "@/services/sse";
import { sendResult } from "@/lib/api-response";

const notificationRepo = new NotificationRepository();
const userRepo = new UserRepository();
const TERM = "1st Semester · AY 2026-2027";
const BSIT_2A_TERM = "2nd Semester · AY 2025-2026";
const BSIT_2A_SUBJECTS = [
  { subjectCode: "F3-DANCE", subjectTitle: "Dance", instructor: "Prof. R. Dela Cruz" },
  { subjectCode: "F3-READING-VISUAL-ARTS", subjectTitle: "Reading Visual Arts", instructor: "Ms. A. Villanueva" },
  { subjectCode: "F3-SCIENCE-TECHNOLOGY-SOCIETY", subjectTitle: "Science, Technology and Society", instructor: "Dr. M. Santos" },
  { subjectCode: "F3-INFORMATION-MANAGEMENT", subjectTitle: "Information Management", instructor: "Mr. J. Cruz" },
  { subjectCode: "F3-IT-TRACK-ELECTIVE-1", subjectTitle: "IT Track Elective 1", instructor: "Prof. R. Dela Cruz" },
  { subjectCode: "F3-OBJECT-ORIENTED-PROGRAMMING", subjectTitle: "Object Oriented Programming", instructor: "Prof. R. Dela Cruz" },
  { subjectCode: "F3-PROBABILITIES-STATISTICS", subjectTitle: "Probabilities and Statistics", instructor: "Mrs. L. Reyes" },
  { subjectCode: "F3-DATA-COMMUNICATIONS-NETWORKING-1", subjectTitle: "Data Communications and Networking 1", instructor: "Mr. J. Cruz" },
  { subjectCode: "F3-QUANTITATIVE-METHODS", subjectTitle: "Quantitative Methods", instructor: "Dr. M. Santos" },
] as const;
function matchesB2A(section: string | null | undefined) { return String(section ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "") === "BSIT2A"; }
function termForSection(section: string | null | undefined) { return matchesB2A(section) ? BSIT_2A_TERM : TERM; }
function subjectsForSection(section: string | null | undefined) {
  return matchesB2A(section) ? BSIT_2A_SUBJECTS.map((subject) => ({ ...subject, subject: subject.subjectTitle })) : [];
}
type InputGrade = { studentUserId: string; subjectCode: string; subjectTitle: string; instructor: string; grade: string };

export class GradeController {
  public listStudents = async (req: Request, res: Response) => {
    const section = String(req.query.section ?? "").trim();
    if (!section || section.length > 80) return sendResult(res, { code: 400, message: "Choose a valid section." });
    try {
      const students = (await userRepo.listStudents()).filter(student => student.section === section);
      if (!students.length) return sendResult(res, { code: 200, data: { students: [] } });
      const terms = [...new Set(students.map((student) => termForSection(student.section)))];
      const savedGrades = await db.select({ studentUserId: gradeRecords.studentUserId, subjectCode: gradeRecords.subjectCode, grade: gradeRecords.grade, acknowledgedAt: gradeRecords.acknowledgedAt }).from(gradeRecords).where(and(inArray(gradeRecords.studentUserId, students.map(student => student.id)), inArray(gradeRecords.term, terms)));
      const responseStudents = students.map(student => ({ ...student, subjects: subjectsForSection(student.section), grades: savedGrades.filter(grade => grade.studentUserId === student.id) }));
      return sendResult(res, { code: 200, data: { students: responseStudents, term: termForSection(section) } });
    } catch (error) {
      console.error("grade list students error", error);
      return sendResult(res, { code: 503, message: "Student accounts could not be loaded." });
    }
  };

  public studentRecords = async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).user?.sub ?? "";
    try {
      const [student] = await db.select({ section: users.section }).from(users).where(eq(users.id, userId)).limit(1);
      const term = termForSection(student?.section);
      const records = await db.select().from(gradeRecords).where(and(eq(gradeRecords.studentUserId, userId), eq(gradeRecords.term, term))).orderBy(gradeRecords.subjectTitle);
      const history = matchesB2A(student?.section)
        ? []
        : await db.select().from(gradeRecords).where(and(eq(gradeRecords.studentUserId, userId), eq(gradeRecords.term, BSIT_2A_TERM))).orderBy(gradeRecords.subjectTitle);
      return sendResult(res, { code: 200, data: { records, history, subjects: subjectsForSection(student?.section), term } });
    } catch (error) {
      console.error("grade student records error", error);
      return sendResult(res, { code: 503, message: "Academic records could not be loaded." });
    }
  };

  public save = async (req: Request, res: Response) => {
    const body = req.body as { records?: InputGrade[] };
    const records = body?.records;
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!Array.isArray(records) || records.length < 1 || records.length > 1000 || records.some((r) => !r || typeof r.studentUserId !== "string" || !uuidPattern.test(r.studentUserId) || typeof r.subjectCode !== "string" || !r.subjectCode.trim() || r.subjectCode.length > 64 || typeof r.subjectTitle !== "string" || !r.subjectTitle.trim() || r.subjectTitle.length > 250 || typeof r.instructor !== "string" || r.instructor.length > 150 || typeof r.grade !== "string" || !r.grade.trim() || r.grade.length > 20)) {
      return sendResult(res, { code: 400, message: "Enter a grade for each selected subject before saving." });
    }
    const unique = new Set(records.map((r) => `${r.studentUserId}|${r.subjectCode}`));
    if (unique.size !== records.length) return sendResult(res, { code: 400, message: "The grade list contains duplicate subjects." });
    try {
      const notifications = new Map<string, string[]>();
      await db.transaction(async (tx) => {
        for (const item of records) {
          const [student] = await tx.select({ id: users.id, section: users.section }).from(users).where(and(eq(users.id, item.studentUserId), eq(users.role, "STUDENT"))).limit(1);
          if (!student) throw new Error("STUDENT_ACCOUNT_NOT_FOUND");
          const term = termForSection(student.section);
          const allowedSubjects = subjectsForSection(student.section);
          if (allowedSubjects.length && !allowedSubjects.some((subject) => subject.subjectCode === item.subjectCode.trim())) throw new Error("SUBJECT_NOT_IN_SECTION");
          const [existing] = await tx.select({ grade: gradeRecords.grade }).from(gradeRecords).where(and(eq(gradeRecords.studentUserId, student.id), eq(gradeRecords.subjectCode, item.subjectCode.trim()), eq(gradeRecords.term, term))).limit(1);
          await tx.insert(gradeRecords).values({ studentUserId: student.id, subjectCode: item.subjectCode.trim(), subjectTitle: item.subjectTitle.trim(), instructor: item.instructor.trim(), term, grade: item.grade.trim(), acknowledgedAt: existing?.grade === item.grade.trim() ? undefined : null, updatedAt: new Date().toISOString() })
            .onConflictDoUpdate({ target: [gradeRecords.studentUserId, gradeRecords.subjectCode, gradeRecords.term], set: { subjectTitle: item.subjectTitle.trim(), instructor: item.instructor.trim(), grade: item.grade.trim(), ...(existing?.grade === item.grade.trim() ? {} : { acknowledgedAt: null }), updatedAt: new Date().toISOString() } });
          if (existing?.grade !== item.grade.trim()) notifications.set(student.id, [...(notifications.get(student.id) ?? []), item.subjectTitle.trim()]);
        }
      });
      await Promise.all([...notifications].map(async ([studentId, subjects]) => {
        const notification = await notificationRepo.create(studentId, { title: "New grades posted", message: `${subjects.length === 1 ? `A grade for ${subjects[0]}` : `${subjects.length} grades`} is available in your academic records.`, type: "info", href: "/academics/grades" });
        broadcastNotificationCreated(studentId, { id: notification.id, title: notification.title ?? null, message: notification.message, type: notification.type, href: notification.href ?? null, createdAt: notification.createdAt });
      }));
      return sendResult(res, { code: 200, data: { saved: records.length, notified: notifications.size } });
    } catch (error) {
      if (error instanceof Error && error.message === "STUDENT_ACCOUNT_NOT_FOUND") return sendResult(res, { code: 404, message: "A student account in this grade list no longer exists. Reload the section and try again." });
      if (error instanceof Error && error.message === "SUBJECT_NOT_IN_SECTION") return sendResult(res, { code: 400, message: "A subject does not belong to the student's current section." });
      console.error("grade save error", error);
      return sendResult(res, { code: 503, message: "Grades could not be saved. Please try again." });
    }
  };

  public acknowledge = async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).user?.sub ?? "";
    try {
      const now = new Date().toISOString();
      const [studentRecord] = await db.select({ section: users.section }).from(users).where(eq(users.id, userId)).limit(1);
      const term = termForSection(studentRecord?.section);
      const result = await db.update(gradeRecords).set({ acknowledgedAt: now }).where(and(eq(gradeRecords.studentUserId, userId), eq(gradeRecords.term, term), isNotNull(gradeRecords.grade), isNull(gradeRecords.acknowledgedAt))).returning({ id: gradeRecords.id });
      broadcastNotificationUpdated(userId);
      if (result.length) {
        const [student] = await db.select({ name: users.name, studentNumber: users.studentNumber }).from(users).where(eq(users.id, userId)).limit(1);
        const databaseStaff = await db.select({ id: users.id }).from(users).where(inArray(users.role, ["REGISTRAR", "ADMIN"]));
        const staff = databaseStaff.length
          ? databaseStaff
          : memUsers.filter(account => account.role === "REGISTRAR" || account.role === "ADMIN").map(account => ({ id: account.id }));
        await Promise.all(staff.map(async ({ id }) => {
          const notification = await notificationRepo.create(id, {
            title: "Student acknowledged grades",
            message: `${student?.name ?? "A student"}${student?.studentNumber ? ` (${student.studentNumber})` : ""} acknowledged their posted grades.`,
            type: "success",
            href: "/admin/academics/sections",
          });
          broadcastNotificationCreated(id, { id: notification.id, title: notification.title ?? null, message: notification.message, type: notification.type, href: notification.href ?? null, createdAt: notification.createdAt });
        }));
      }
      return sendResult(res, { code: 200, data: { acknowledged: result.length, acknowledgedAt: now } });
    } catch (error) {
      console.error("grade acknowledgement error", error);
      return sendResult(res, { code: 503, message: "Your acknowledgement could not be saved." });
    }
  };
}


