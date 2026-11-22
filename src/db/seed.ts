import bcrypt from "bcrypt";
import { and, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { academicEvents, users } from "@/db/schema";
import { SEED_ACADEMIC_EVENTS } from "@/db/academic-event-seed";

async function seed() {
  console.log("🌱 Seeding CPC initial accounts...");

  // Remove only the legacy, manually seeded student demo logins. Registrar-
  // created student accounts use real numeric IDs and are left untouched.
  const removedDemoStudents = await db.delete(users).where(and(
    eq(users.role, "STUDENT"),
    or(
      and(eq(users.email, "student@cpc.edu.ph"), eq(users.studentNumber, "STU-2026-0042")),
      and(eq(users.email, "maria.student@cpc.edu.ph"), eq(users.studentNumber, "STU-2026-0231")),
    ),
  )).returning({ email: users.email });
  if (removedDemoStudents.length) console.log(`🧹 Removed ${removedDemoStudents.length} legacy demo student account(s).`);

  const defaultPassword = await bcrypt.hash("123456", 10);

  const initialUsers = [
    {
      name: "Maria Santos",
      email: "admin@cpc.edu.ph",
      password: defaultPassword,
      role: "ADMIN" as const,
      department: "Office of the Administrator",
    },
    {
      name: "Mrs. Liza Reyes",
      email: "registrar@cpc.edu.ph",
      password: defaultPassword,
      role: "REGISTRAR" as const,
      department: "Registrar's Office",
    },
    {
      name: "Dr. Miguel Santos",
      email: "dean@cpc.edu.ph",
      password: defaultPassword,
      role: "DEAN" as const,
      department: "College of Computer Studies",
    },
    {
      name: "Dr. Carmen Ramos",
      email: "dean.edu@cpc.edu.ph",
      password: defaultPassword,
      role: "DEAN" as const,
      department: "College of Teacher Education",
    },
    {
      name: "Prof. Elena Valdez",
      email: "dean.hm@cpc.edu.ph",
      password: defaultPassword,
      role: "DEAN" as const,
      department: "College of Hospitality Management",
    },
    {
      name: "Prof. Lorna Fernandez",
      email: "sao@cpc.edu.ph",
      password: defaultPassword,
      role: "SAO" as const,
      department: "Student Affairs Office",
    },
    {
      name: "Ms. Ana Villanueva",
      email: "library@cpc.edu.ph",
      password: defaultPassword,
      role: "LIBRARY" as const,
      department: "Library",
    },
    {
      name: "Mr. Jose Cruz",
      email: "accounting@cpc.edu.ph",
      password: defaultPassword,
      role: "ACCOUNTING" as const,
      department: "Accounting Office",
    },
    {
      name: "Prof. Ramon Dela Cruz",
      email: "instructor@cpc.edu.ph",
      password: defaultPassword,
      role: "INSTRUCTOR" as const,
      department: "College of Computer Studies",
    },
    {
      name: "Mrs. Grace Tan",
      email: "guidance@cpc.edu.ph",
      password: defaultPassword,
      role: "GUIDANCE" as const,
      department: "Guidance Office",
    },
    {
      name: "Dr. Arthur Morales",
      email: "clinic@cpc.edu.ph",
      password: defaultPassword,
      role: "CLINIC" as const,
      department: "Clinic",
    },
  ];

  for (const item of initialUsers) {
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, item.email))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(users).values(item);
      console.log(`✅ Created: ${item.name} (${item.email}) - Role: ${item.role}`);
    } else {
      await db
        .update(users)
        .set(item)
        .where(eq(users.email, item.email));
      console.log(`🔄 Updated: ${item.name} (${item.email}) - Role: ${item.role}`);
    }
  }

  console.log("✨ Seeding completed successfully!");

  await db
    .insert(academicEvents)
    .values(
      SEED_ACADEMIC_EVENTS.map((event) => ({
        ...event,
        endDate: event.endDate ?? null,
        startTime: event.startTime ?? null,
        endTime: event.endTime ?? null,
        location: event.location ?? null,
        organizer: event.organizer ?? null,
        department: event.department ?? null,
        notes: event.notes ?? null,
        targetAudience: event.targetAudience ?? null,
      })),
    )
    .onConflictDoNothing();
  console.log(`🎓 Academic calendar events available (${SEED_ACADEMIC_EVENTS.length} samples).`);

  process.exit(0);
}

seed().catch((err) => {
  console.error("❌ Seeding failed:", err);
  process.exit(1);
});
