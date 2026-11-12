import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";

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
  process.exit(0);
}

seed().catch((err) => {
  console.error("❌ Seeding failed:", err);
  process.exit(1);
});
