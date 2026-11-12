import { eq, or, inArray } from "drizzle-orm";
import { db } from "@/db";
import { users, role } from "@/db/schema";
import type { SignupInput } from "@/schema/auth-schema";
import { randomUUID } from "node:crypto";

// Return account details without exposing the stored password hash.
export const publicUserFields = {
  id: users.id,
  name: users.name,
  email: users.email,
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
  email: string;
  password: string;
  role: any;
  studentNumber?: string | null;
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

export const HARRY_AVATAR = "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128"><defs><linearGradient id="bgH" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#1B2F9E"/><stop offset="100%" stop-color="#4B5FA8"/></linearGradient></defs><circle cx="64" cy="64" r="64" fill="url(#bgH)"/><path d="M24 128 C24 96 40 84 64 84 C88 84 104 96 104 128 Z" fill="#E2E8F0"/><path d="M52 84 L64 104 L76 84 Z" fill="#1B2F9E"/><rect x="54" y="68" width="20" height="20" rx="4" fill="#FCD34D"/><circle cx="64" cy="50" r="26" fill="#FCD34D"/><path d="M38 46 C38 24 50 20 64 20 C78 20 90 24 90 46 C90 32 80 26 64 26 C48 26 38 34 38 46 Z" fill="#3E2723"/><path d="M42 36 C46 26 60 22 74 24 C82 25 88 30 88 38 C80 32 68 30 54 32 C46 33 42 36 42 36 Z" fill="#2E1B15"/><rect x="44" y="44" width="16" height="12" rx="3" fill="none" stroke="#1E293B" stroke-width="2.5"/><rect x="68" y="44" width="16" height="12" rx="3" fill="none" stroke="#1E293B" stroke-width="2.5"/><line x1="60" y1="50" x2="68" y2="50" stroke="#1E293B" stroke-width="2.5"/><circle cx="52" cy="50" r="2" fill="#1E293B"/><circle cx="76" cy="50" r="2" fill="#1E293B"/><path d="M56 60 Q64 66 72 60" fill="none" stroke="#B45309" stroke-width="2.5" stroke-linecap="round"/></svg>`);

export const MARIA_AVATAR = "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128"><defs><linearGradient id="bgM" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#047857"/><stop offset="100%" stop-color="#10B981"/></linearGradient></defs><circle cx="64" cy="64" r="64" fill="url(#bgM)"/><path d="M30 52 C30 90 42 108 42 108 L86 108 C86 108 98 90 98 52 C98 22 84 18 64 18 C44 18 30 22 30 52 Z" fill="#1F2937"/><path d="M26 128 C26 98 40 86 64 86 C88 86 102 98 102 128 Z" fill="#FEF3C7"/><path d="M50 86 L64 106 L78 86 Z" fill="#047857"/><rect x="54" y="68" width="20" height="22" rx="4" fill="#FDE68A"/><circle cx="64" cy="52" r="25" fill="#FDE68A"/><path d="M38 46 C42 30 54 22 64 22 C78 22 90 32 90 46 C84 32 72 28 64 30 C52 32 44 38 38 46 Z" fill="#111827"/><path d="M36 50 C36 40 40 34 46 30 C42 36 40 44 40 54 Z" fill="#111827"/><path d="M92 50 C92 40 88 34 82 30 C86 36 88 44 88 54 Z" fill="#111827"/><circle cx="53" cy="50" r="2.5" fill="#1F2937"/><circle cx="75" cy="50" r="2.5" fill="#1F2937"/><path d="M49 46 Q53 44 57 46" fill="none" stroke="#111827" stroke-width="1.8" stroke-linecap="round"/><path d="M71 46 Q75 44 79 46" fill="none" stroke="#111827" stroke-width="1.8" stroke-linecap="round"/><path d="M56 62 Q64 68 72 62" fill="none" stroke="#D97706" stroke-width="2.5" stroke-linecap="round"/><circle cx="48" cy="56" r="3" fill="#FCA5A5" opacity="0.6"/><circle cx="80" cy="56" r="3" fill="#FCA5A5" opacity="0.6"/></svg>`);

export const ADMIN_AVATAR = "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128"><defs><linearGradient id="bgA" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#0F2468"/><stop offset="100%" stop-color="#1B2F9E"/></linearGradient></defs><circle cx="64" cy="64" r="64" fill="url(#bgA)"/><path d="M22 128 C22 96 38 84 64 84 C90 84 106 96 106 128 Z" fill="#1E293B"/><path d="M48 84 L64 116 L80 84 Z" fill="#FFFFFF"/><path d="M58 84 L64 122 L70 84 Z" fill="#DC2626"/><rect x="54" y="66" width="20" height="20" rx="4" fill="#FDE047"/><circle cx="64" cy="48" r="25" fill="#FDE047"/><path d="M38 42 C38 22 50 18 64 18 C78 18 90 22 90 42 C90 28 80 24 64 24 C48 24 38 30 38 42 Z" fill="#334155"/><circle cx="53" cy="48" r="2.5" fill="#1E293B"/><circle cx="75" cy="48" r="2.5" fill="#1E293B"/><path d="M56 58 Q64 64 72 58" fill="none" stroke="#CA8A04" stroke-width="2.5" stroke-linecap="round"/></svg>`);

export const memUsers: FallbackUser[] = [
  {
    id: "a1111111-1111-1111-1111-111111111111",
    name: "Harry Styles",
    email: "student@cpc.edu.ph",
    studentNumber: "STU-2026-0042",
    password: DEFAULT_HASH,
    role: "STUDENT",
    course: "Bachelor of Science in Information Technology",
    yearLevel: 3,
    department: "College of Computer Studies",
    phone: "+63 912 345 6789",
    avatarUrl: HARRY_AVATAR,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    emailVerified: new Date().toISOString(),
  },
  {
    id: "a2222222-2222-2222-2222-222222222222",
    name: "Maria Santos",
    email: "maria.student@cpc.edu.ph",
    studentNumber: "STU-2026-0231",
    password: DEFAULT_HASH,
    role: "STUDENT",
    course: "Bachelor of Science in Hospitality Management",
    yearLevel: 2,
    department: "College of Hospitality Management",
    phone: "+63 998 765 4321",
    avatarUrl: MARIA_AVATAR,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    emailVerified: new Date().toISOString(),
  },
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
];

export class UserRepository {
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
      return rows.map((row) => row.id);
    } catch {
      return memUsers
        .filter((user) => roles.includes(String(user.role)))
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

    return memUsers.find((u) => u.email.toLowerCase() === cleanEmail) ?? null;
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
          u.email.toLowerCase() === cleaned.toLowerCase() ||
          (u.studentNumber && u.studentNumber.toLowerCase() === cleaned.toLowerCase())
      ) ?? null
    );
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
