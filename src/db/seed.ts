import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { academicEvents, users } from "@/db/schema";
import { SEED_ACADEMIC_EVENTS } from "@/db/academic-event-seed";

async function seed() {
  console.log("🌱 Seeding CPC initial accounts...");

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
      name: "Harry Styles",
      email: "student@cpc.edu.ph",
      studentNumber: "STU-2026-0042",
      password: defaultPassword,
      role: "STUDENT" as const,
      course: "Bachelor of Science in Information Technology",
      yearLevel: 3,
      department: "College of Computer Studies",
    },
    {
      name: "Maria Santos",
      email: "maria.student@cpc.edu.ph",
      studentNumber: "STU-2026-0231",
      password: defaultPassword,
      role: "STUDENT" as const,
      course: "Bachelor of Science in Hospitality Management",
      yearLevel: 2,
      department: "College of Hospitality Management",
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
