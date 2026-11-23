import { eq, or, inArray, and } from "drizzle-orm";
import { db } from "@/db";
import {
  users,
  role,
  masterlist,
  studentProfiles,
  enrollmentSessions,
  signatureQueueProcessing,
  signatureOfficeDailyCounts,
} from "@/db/schema";
import type { SignupInput } from "@/schema/auth-schema";
import { randomUUID } from "node:crypto";

// Return account details without exposing the stored password hash.
export const publicUserFields = {
  id: users.id,
  name: users.name,
  email: users.email,
  section: users.section,
  mustChangePassword: users.mustChangePassword,
  role: users.role,
  studentNumber: users.studentNumber,
  course: users.course,
  yearLevel: users.yearLevel,
  department: users.department,
  avatarUrl: users.avatarUrl,
  phone: users.phone,
  emailVerified: users.emailVerified,
  createdAt: users.createdAt,
};

type FallbackUser = {
  id: string;
  name: string;
  email: string | null;
  password: string;
  role: any;
  studentNumber?: string | null;
  section?: string | null;
  mustChangePassword?: boolean;
  course?: string | null;
  yearLevel?: number | null;
  department?: string | null;
  avatarUrl?: string | null;
  phone?: string | null;
  emailVerified?: string | null;
  createdAt: string;
  updatedAt: string;
};

// Seeded users with password "123456"
const DEFAULT_HASH = "$2b$10$g60gOMyZTkIL/H5S/dbokuiUpoVTtMJhNjOh/Ont2E.qK/RV9i4.y";

export const ADMIN_AVATAR = "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128"><defs><linearGradient id="bgA" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#0F2468"/><stop offset="100%" stop-color="#1B2F9E"/></linearGradient></defs><circle cx="64" cy="64" r="64" fill="url(#bgA)"/><path d="M22 128 C22 96 38 84 64 84 C90 84 106 96 106 128 Z" fill="#1E293B"/><path d="M48 84 L64 116 L80 84 Z" fill="#FFFFFF"/><path d="M58 84 L64 122 L70 84 Z" fill="#DC2626"/><rect x="54" y="66" width="20" height="20" rx="4" fill="#FDE047"/><circle cx="64" cy="48" r="25" fill="#FDE047"/><path d="M38 42 C38 22 50 18 64 18 C78 18 90 22 90 42 C90 28 80 24 64 24 C48 24 38 30 38 42 Z" fill="#334155"/><circle cx="53" cy="48" r="2.5" fill="#1E293B"/><circle cx="75" cy="48" r="2.5" fill="#1E293B"/><path d="M56 58 Q64 64 72 58" fill="none" stroke="#CA8A04" stroke-width="2.5" stroke-linecap="round"/></svg>`);

export const memUsers: FallbackUser[] = [
  {
    id: "a3333333-3333-3333-3333-333333333333",
    name: "Maria Santos",
    email: "admin@cpc.edu.ph",
    studentNumber: null,
    password: DEFAULT_HASH,
    role: "ADMIN",
    course: null,
    yearLevel: null,
    department: "Office of the Administrator",
    phone: null,
    avatarUrl: ADMIN_AVATAR,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    emailVerified: new Date().toISOString(),
  },
  {
    id: "a4444444-4444-4444-4444-444444444444",
    name: "Mrs. Liza Reyes",
    email: "registrar@cpc.edu.ph",
    studentNumber: null,
    password: DEFAULT_HASH,
    role: "REGISTRAR",
    course: null,
    yearLevel: null,
    department: "Registrar's Office",
    phone: null,
    avatarUrl: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    emailVerified: new Date().toISOString(),
  },
  {
    id: "a5555555-5555-5555-5555-555555555555",
    name: "Dr. Miguel Santos",
    email: "dean@cpc.edu.ph",
    studentNumber: null,
    password: DEFAULT_HASH,
    role: "DEAN",
    course: null,
    yearLevel: null,
    department: "College of Computer Studies",
    phone: null,
    avatarUrl: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    emailVerified: new Date().toISOString(),
  },
  {
    id: "a6666666-6666-6666-6666-666666666666",
    name: "Dr. Carmen Ramos",
    email: "dean.edu@cpc.edu.ph",
    studentNumber: null,
    password: DEFAULT_HASH,
    role: "DEAN",
    course: null,
    yearLevel: null,
    department: "College of Teacher Education",
    phone: null,
    avatarUrl: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    emailVerified: new Date().toISOString(),
  },
  {
    id: "a7777777-7777-7777-7777-777777777777",
    name: "Prof. Elena Valdez",
    email: "dean.hm@cpc.edu.ph",
    studentNumber: null,
    password: DEFAULT_HASH,
    role: "DEAN",
    course: null,
    yearLevel: null,
    department: "College of Hospitality Management",
    phone: null,
    avatarUrl: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    emailVerified: new Date().toISOString(),
  },
  {
    id: "a8888888-8888-8888-8888-888888888888",
    name: "Prof. Lorna Fernandez",
    email: "sao@cpc.edu.ph",
    studentNumber: null,
    password: DEFAULT_HASH,
    role: "SAO",
    course: null,
    yearLevel: null,
    department: "Student Affairs Office",
    phone: null,
    avatarUrl: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    emailVerified: new Date().toISOString(),
  },
  {
    id: "a9999999-9999-9999-9999-999999999999",
    name: "Ms. Ana Villanueva",
    email: "library@cpc.edu.ph",
    studentNumber: null,
    password: DEFAULT_HASH,
    role: "LIBRARY",
    course: null,
    yearLevel: null,
    department: "Library",
    phone: null,
    avatarUrl: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    emailVerified: new Date().toISOString(),
  },
  {
    id: "b1111111-1111-1111-1111-111111111111",
    name: "Mr. Jose Cruz",
    email: "accounting@cpc.edu.ph",
    studentNumber: null,
    password: DEFAULT_HASH,
    role: "ACCOUNTING",
    course: null,
    yearLevel: null,
    department: "Accounting Office",
    phone: null,
    avatarUrl: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    emailVerified: new Date().toISOString(),
  },
  {
    id: "b2222222-2222-2222-2222-222222222222",
    name: "Prof. Ramon Dela Cruz",
    email: "instructor@cpc.edu.ph",
    studentNumber: null,
    password: DEFAULT_HASH,
    role: "INSTRUCTOR",
    course: null,
    yearLevel: null,
    department: "College of Computer Studies",
    phone: null,
    avatarUrl: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    emailVerified: new Date().toISOString(),
  },
  {
    id: "b3333333-3333-3333-3333-333333333333",
    name: "Mrs. Grace Tan",
    email: "guidance@cpc.edu.ph",
    studentNumber: null,
    password: DEFAULT_HASH,
    role: "GUIDANCE",
    course: null,
    yearLevel: null,
    department: "Guidance Office",
    phone: null,
    avatarUrl: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    emailVerified: new Date().toISOString(),
  },
  {
    id: "b4444444-4444-4444-4444-444444444444",
    name: "Dr. Arthur Morales",
    email: "clinic@cpc.edu.ph",
    studentNumber: null,
    password: DEFAULT_HASH,
    role: "CLINIC",
    course: null,
    yearLevel: null,
    department: "Clinic",
    phone: null,
    avatarUrl: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    emailVerified: new Date().toISOString(),
  },
];

const memContinuingRecords: Array<{
  studentIdNo: string;
  name: string;
  department: string;
  course: string;
  yearLevel: number;
  semester: number;
  standing: "regular";
  lastTermEnrolled: string;
  isEligible: boolean;
}> = [];

export class UserRepository {
  /**
   * The demonstration staff sign-in can authenticate a fallback role account
   * from memory. Clearance notifications need a durable user row, however,
   * because the feed is scoped to `user_id` in the database. If a role has no
   * provisioned account yet, persist its existing demo account before routing
   * the request. Real accounts always take precedence.
   */
  async ensureDemoStaffAccountsForRole(roleName: string) {
    const typedRole = roleName as (typeof role.enumValues)[number];
    const fallbackAccounts = memUsers.filter(
      (user) => user.role === roleName && user.role !== "STUDENT" && user.email,
    );
    for (const account of fallbackAccounts) {
      const [existing] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, account.email!.toLowerCase()))
        .limit(1);
      if (existing) continue;
      await db.insert(users).values(account).onConflictDoNothing();
    }

    return db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, typedRole));
  }

  async findById(id: string) {
    try {
      const [user] = await db.select(publicUserFields).from(users).where(eq(users.id, id)).limit(1);
      if (user) return user;
    } catch {
      // Fall through to memory
    }

    const found = memUsers.find((u) => u.id === id);
    if (!found) return null;
    const { password: _pw, ...pub } = found;
    void _pw;
    return pub as any;
  }

  /** Ids of every account holding one of the given staff roles. */
  async findIdsByRoles(roles: string[]) {
    try {
      const rows = await db
        .select({ id: users.id })
        .from(users)
        .where(inArray(users.role, roles as (typeof role.enumValues)[number][]));
      if (rows.length > 0) return rows.map((row) => row.id);
      // Keep the seeded in-memory staff accounts reachable when the users
      // table is connected but has not been populated with staff records.
      return memUsers
        .filter((user) => roles.includes(String(user.role)))
        .map((user) => user.id);
    } catch {
      return memUsers
        .filter((user) => roles.includes(String(user.role)))
        .map((user) => user.id);
    }
  }

  async findIdsByRoleAndDepartment(roleName: string, department: string) {
    try {
      const rows = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.role, roleName as (typeof role.enumValues)[number]), eq(users.department, department)));
      return rows.map((row) => row.id);
    } catch {
      return memUsers
        .filter((user) => user.role === roleName && user.department === department)
        .map((user) => user.id);
    }
  }

  async findByEmail(email: string) {
    const cleanEmail = email.toLowerCase().trim();
    try {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, cleanEmail))
        .limit(1);
      if (user) return user;
    } catch {
      // Fall through to memory
    }

    return memUsers.find((u) => u.email?.toLowerCase() === cleanEmail) ?? null;
  }

  async findByIdentifier(identifier: string) {
    const cleaned = identifier.trim();
    try {
      const [user] = await db
        .select()
        .from(users)
        .where(
          or(
            eq(users.email, cleaned.toLowerCase()),
            eq(users.studentNumber, cleaned)
          )
        )
        .limit(1);
      if (user) return user;
    } catch {
      // Fall through to memory
    }

    return (
      memUsers.find(
        (u) =>
          u.email?.toLowerCase() === cleaned.toLowerCase() ||
          (u.studentNumber && u.studentNumber.toLowerCase() === cleaned.toLowerCase())
      ) ?? null
    );
  }

  async listStudents() {
    const rows = await db.select({
      id: users.id,
      name: users.name,
      studentNumber: users.studentNumber,
      section: users.section,
      course: masterlist.course,
      yearLevel: masterlist.yearLevel,
    })
      .from(users)
      .leftJoin(masterlist, eq(masterlist.studentIdNo, users.studentNumber))
      .where(eq(users.role, "STUDENT"))
      .orderBy(users.studentNumber);

    // Registrar-created accounts use the numeric ID sequence. Keep seeded/demo
    // student logins out of the operational Registrar directory.
    return rows.filter((student) => {
      const id = student.studentNumber ?? "";
      return /^\d{8}$/.test(id) && Number(id) >= 20240770;
    });
  }

  async createRegistrarStudent(input: {
    name: string;
    studentNumber: string;
    section: string;
    password: string;
    department: string;
    course: string;
    yearLevel: number;
    lastTermEnrolled: string;
    gender: string;
    dateOfBirth: string;
  }) {
    const values = {
      name: input.name,
      studentNumber: input.studentNumber,
      section: input.section,
      course: input.course,
      yearLevel: input.yearLevel,
      department: input.department,
      email: null,
      password: input.password,
      role: "STUDENT" as const,
      mustChangePassword: true,
    };
    // Registrar accounts must be durable. Never report success for a memory-only
    // student account that disappears when the API process restarts.
    return db.transaction(async (tx) => {
      const [user] = await tx.insert(users).values(values).returning(publicUserFields);
      if (!user) return null;
      await tx.insert(masterlist).values({
        studentIdNo: input.studentNumber,
        name: input.name,
        department: input.department,
        course: input.course,
        yearLevel: input.yearLevel,
        semester: 2,
        standing: "regular",
        lastTermEnrolled: input.lastTermEnrolled,
        isEligible: true,
      });
      await tx.insert(studentProfiles).values({
        userId: user.id,
        gender: input.gender,
        dateOfBirth: input.dateOfBirth,
      });
      return user;
    });
  }

  async deleteRegistrarStudent(userId: string) {
    return db.transaction(async (tx) => {
      const [student] = await tx.select({
        id: users.id,
        studentNumber: users.studentNumber,
      })
        .from(users)
        .where(and(eq(users.id, userId), eq(users.role, "STUDENT")))
        .limit(1);

      if (!student?.studentNumber || !/^\d{8}$/.test(student.studentNumber) || Number(student.studentNumber) < 20240770) {
        return false;
      }

      const localDate = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
      }).format(new Date());
      const [sessionRow] = await tx.select({ session: enrollmentSessions.session })
        .from(enrollmentSessions)
        .where(eq(enrollmentSessions.studentId, student.studentNumber))
        .limit(1);
      const session = sessionRow?.session as {
        signatureRequests?: Record<string, unknown>;
        signatureQueue?: Record<string, { date?: string; number?: number | string }>;
        steps?: Record<string, { status?: string }>;
        clearance?: { offices?: Array<{ office?: string; status?: string; queueDate?: string; queueNumber?: number }> };
      } | undefined;
      const tracks = new Map<string, { queueType: string; office: string }>();
      for (const [office, requestAt] of Object.entries(session?.signatureRequests ?? {})) {
        const queue = session?.signatureQueue?.[office];
        if (requestAt && session?.steps?.[office]?.status === "PENDING" && queue?.date === localDate) {
          tracks.set(`study_load:${office}`, { queueType: "study_load", office });
        }
      }
      for (const request of session?.clearance?.offices ?? []) {
        if (request.status === "requested" && request.office && request.queueDate === localDate) {
          tracks.set(`office_signatures:${request.office}`, { queueType: "office_signatures", office: request.office });
        }
      }

      const activeRows = await tx.select({ queueType: signatureQueueProcessing.queueType, office: signatureQueueProcessing.office })
        .from(signatureQueueProcessing)
        .where(eq(signatureQueueProcessing.studentId, student.studentNumber));
      for (const active of activeRows) {
        tracks.set(`${active.queueType}:${active.office}`, { queueType: active.queueType, office: active.office });
      }

      // Queue requests and their numbers live in the enrollment session. Remove
      // both the saved session and any active office-processing marker directly.
      await tx.delete(signatureQueueProcessing).where(eq(signatureQueueProcessing.studentId, student.studentNumber));
      await tx.delete(enrollmentSessions).where(eq(enrollmentSessions.studentId, student.studentNumber));

      // Start an office back at #1 after this deletion only if nobody else has
      // a request waiting or in process there. Otherwise preserve its sequence.
      if (tracks.size) {
        const remainingRows = await tx.select({ session: enrollmentSessions.session }).from(enrollmentSessions);
        for (const track of tracks.values()) {
          const anotherRequestIsOpen = remainingRows.some(({ session: value }) => {
            const other = value as typeof session;
            if (track.queueType === "study_load") {
              return Boolean(other?.signatureRequests?.[track.office]
                && other.steps?.[track.office]?.status === "PENDING"
                && other.signatureQueue?.[track.office]?.date === localDate);
            }
            return (other?.clearance?.offices ?? []).some((request) =>
              request.office === track.office && request.status === "requested" && request.queueDate === localDate,
            );
          });
          if (!anotherRequestIsOpen) {
            await tx.update(signatureOfficeDailyCounts).set({ lastQueueNumber: 0 }).where(and(
              eq(signatureOfficeDailyCounts.queueType, track.queueType),
              eq(signatureOfficeDailyCounts.office, track.office),
              eq(signatureOfficeDailyCounts.localDate, localDate),
            ));
          }
        }
      }

      // Account-owned rows such as requests, grades, and notifications are
      // removed by their user foreign-key cascades.
      await tx.delete(masterlist).where(eq(masterlist.studentIdNo, student.studentNumber));
      const [deleted] = await tx.delete(users).where(eq(users.id, student.id)).returning({ id: users.id });
      return Boolean(deleted);
    });
  }

  async findContinuingRecordByUserId(userId: string) {
    try {
      const [user] = await db.select({
        studentNumber: users.studentNumber,
        section: users.section,
        name: users.name,
        role: users.role,
        course: users.course,
        yearLevel: users.yearLevel,
        department: users.department,
      }).from(users).where(eq(users.id, userId)).limit(1);
      if (!user?.studentNumber) return null;

      let [record] = await db.select().from(masterlist).where(eq(masterlist.studentIdNo, user.studentNumber)).limit(1);

      // Older registrar-created accounts may predate the transaction that
      // writes the continuing-student masterlist. Rebuild that missing row
      // from the account's Registrar-assigned ID and section.
      const normalizedId = Number(user.studentNumber);
      const sectionMatch = /^(BSIT|BEED|BSHM)-?([1-4])([A-Z])$/i.exec((user.section ?? "").replace(/\s+/g, ""));
      if (!record && user.role === "STUDENT" && /^\d{8}$/.test(user.studentNumber) && normalizedId >= 20240770 && sectionMatch) {
        const department = sectionMatch[1].toUpperCase();
        const yearLevel = user.yearLevel ?? Number(sectionMatch[2]);
        const course = user.course ?? ({
          BSIT: "BS Information Technology",
          BEED: "Bachelor of Elementary Education",
          BSHM: "BS Hospitality Management",
        } as const)[department as "BSIT" | "BEED" | "BSHM"];
        const [created] = await db.insert(masterlist).values({
          studentIdNo: user.studentNumber,
          name: user.name,
          department: user.department ?? department,
          course,
          yearLevel,
          semester: 2,
          standing: "regular",
          lastTermEnrolled: "2025-2026 2nd Semester",
          isEligible: true,
        }).onConflictDoNothing().returning();
        record = created ?? (await db.select().from(masterlist).where(eq(masterlist.studentIdNo, user.studentNumber)).limit(1))[0];
      }

      return record ? { ...record, section: user.section ?? "" } : null;
    } catch {
      const user = memUsers.find((entry) => entry.id === userId);
      if (!user?.studentNumber) return null;
      return memContinuingRecords.find((record) => record.studentIdNo === user.studentNumber) ?? null;
    }
  }

  async findByIdWithPassword(id: string) {
    try {
      const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
      if (user) return user;
    } catch {
      // Fall through to the development memory store.
    }
    return memUsers.find((user) => user.id === id) ?? null;
  }

  async updatePassword(id: string, password: string) {
    try {
      const [user] = await db.update(users).set({ password, mustChangePassword: false }).where(eq(users.id, id)).returning(publicUserFields);
      if (user) return user;
    } catch {
      // Fall through to the development memory store.
    }
    const user = memUsers.find((entry) => entry.id === id);
    if (!user) return null;
    user.password = password;
    user.mustChangePassword = false;
    user.updatedAt = new Date().toISOString();
    const { password: _password, ...publicUser } = user;
    void _password;
    return publicUser;
  }

  async create(data: SignupInput & { role?: any }) {
    try {
      const [user] = await db
        .insert(users)
        .values({
          ...data,
          email: data.email.toLowerCase().trim(),
        })
        .returning(publicUserFields);

      if (user) return user;
    } catch {
      // Fall through to memory
    }

    const newId = randomUUID();
    const newUser: FallbackUser = {
      id: newId,
      name: data.name,
      email: data.email.toLowerCase().trim(),
      password: data.password,
      role: data.role ?? "STUDENT",
      studentNumber: data.studentNumber ?? null,
      course: data.course ?? null,
      yearLevel: data.yearLevel ?? null,
      department: data.department ?? null,
      avatarUrl: null,
      phone: null,
      emailVerified: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    memUsers.push(newUser);
    const { password: _pw, ...pub } = newUser;
    void _pw;
    return pub as any;
  }

  async markEmailVerified(userId: string) {
    try {
      const [user] = await db
        .update(users)
        .set({ emailVerified: new Date().toISOString() })
        .where(eq(users.id, userId))
        .returning({
          id: users.id,
          email: users.email,
          emailVerified: users.emailVerified,
        });

      if (user) return user;
    } catch {
      // Fall through to memory
    }

    const found = memUsers.find((u) => u.id === userId);
    if (found) {
      found.emailVerified = new Date().toISOString();
      return { id: found.id, email: found.email, emailVerified: found.emailVerified };
    }
    return null;
  }

  async updateStudentName(userId: string, name: string) {
    try {
      const updated = await db.transaction(async (tx) => {
        const [student] = await tx.update(users).set({ name, updatedAt: new Date().toISOString() })
          .where(eq(users.id, userId)).returning(publicUserFields);
        if (student?.studentNumber) {
          await tx.update(masterlist).set({ name }).where(eq(masterlist.studentIdNo, student.studentNumber));
        }
        return student;
      });
      if (updated) return updated;
    } catch {
      // Fall through to memory.
    }
    const found = memUsers.find((user) => user.id === userId);
    if (!found) return null;
    found.name = name;
    found.updatedAt = new Date().toISOString();
    const { password: _password, ...publicUser } = found;
    void _password;
    return publicUser as any;
  }

  async updateStudentEmail(userId: string, email: string) {
    try {
      const [updated] = await db.update(users).set({ email, emailVerified: null, updatedAt: new Date().toISOString() })
        .where(eq(users.id, userId)).returning(publicUserFields);
      if (updated) return updated;
    } catch (error) {
      if ((error as { code?: string })?.code === "23505") {
        const conflict = new Error("That email address is already used by another account.");
        Object.assign(conflict, { code: 409 });
        throw conflict;
      }
      // Fall through to memory when no database row is available.
    }
    const found = memUsers.find((user) => user.id === userId);
    if (!found) return null;
    const duplicate = memUsers.some((user) => user.id !== userId && user.email?.toLowerCase() === email.toLowerCase());
    if (duplicate) {
      const conflict = new Error("That email address is already used by another account.");
      Object.assign(conflict, { code: 409 });
      throw conflict;
    }
    found.email = email;
    found.emailVerified = null;
    found.updatedAt = new Date().toISOString();
    const { password: _password, ...publicUser } = found;
    void _password;
    return publicUser as any;
  }

  async updateAvatarUrl(userId: string, avatarUrl: string) {
    try {
      const [updated] = await db
        .update(users)
        .set({ avatarUrl })
        .where(eq(users.id, userId))
        .returning(publicUserFields);
      if (updated) {
        const found = memUsers.find((u) => u.id === userId);
        if (found) found.avatarUrl = avatarUrl;
        return updated;
      }
    } catch {
      // Fall through to memory
    }

    const found = memUsers.find((u) => u.id === userId);
    if (found) {
      found.avatarUrl = avatarUrl;
      const { password: _pw, ...pub } = found;
      void _pw;
      return pub as any;
    }
    return null;
  }
}
