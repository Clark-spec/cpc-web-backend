import bcrypt from "bcrypt";
import { UserRepository } from "@/repositories/user-repository";

const userRepository = new UserRepository();
const FIRST_STUDENT_ID = 20240770;
const DEFAULT_PASSWORD = "123456";

export async function listStudentAccountsService() {
  try {
    return { code: 200, status: "success", data: { students: await userRepository.listStudents() } };
  } catch {
    return { code: 503, status: "error", message: "Student accounts could not be loaded from the database." };
  }
}

export async function deleteStudentAccountService(userId: string) {
  try {
    const deleted = await userRepository.deleteRegistrarStudent(userId);
    return deleted
      ? { code: 200, status: "success", message: "Student account deleted." }
      : { code: 404, status: "error", message: "Registrar-created student account was not found." };
  } catch (error) {
    console.error("deleteStudentAccountService error", error);
    return { code: 500, status: "error", message: "Unable to delete the student account." };
  }
}

export async function createStudentAccountService(name: string, section: string) {
  try {
    const students = await userRepository.listStudents();
    const highest = students.reduce((max, student) => {
      const id = student.studentNumber ?? "";
      if (!/^\d{8}$/.test(id) || Number(id) < FIRST_STUDENT_ID) return max;
      return Math.max(max, Number(id));
    }, FIRST_STUDENT_ID - 1);
    const studentNumber = String(highest + 1);
    const normalizedSection = section.trim().toUpperCase();
    const department = (normalizedSection.match(/\b(BSIT|BEED|BSHM)\b/)?.[1] ?? "BSIT") as "BSIT" | "BEED" | "BSHM";
    const yearMatch = normalizedSection.match(/(?:^|\s|-)([1-4])(?:\s*-\s*[A-Z]|\s*[A-Z])?$/);
    const yearLevel = Number(yearMatch?.[1] ?? 2);
    const course = {
      BSIT: "BS Information Technology",
      BEED: "Bachelor of Elementary Education",
      BSHM: "BS Hospitality Management",
    }[department];
    const lastTermEnrolled = "2025-2026 2nd Semester";
    const created = await userRepository.createRegistrarStudent({
      name: name.trim(), section: section.trim(), studentNumber,
      password: await bcrypt.hash(DEFAULT_PASSWORD, 10),
      department, course, yearLevel, lastTermEnrolled,
    });
    return {
      code: 201,
      status: "success",
      message: "Student account created",
      data: {
        student: created,
        defaultPassword: DEFAULT_PASSWORD,
        continuingRecord: {
          studentIdNo: studentNumber,
          name: name.trim(),
          department,
          course,
          yearLevel,
          semester: 2,
          standing: "regular" as const,
          lastTermEnrolled,
          isEligible: true,
        },
      },
    };
  } catch (error) {
    if ((error as { code?: string })?.code === "23505") {
      return { code: 409, status: "error", message: "That student ID is already in use. Please try again." };
    }
    console.error("createStudentAccountService error", error);
    return {
      code: 503,
      status: "error",
      message: "Student account could not be saved to the database. Please try again.",
    };
  }
}

export async function getStudentContinuingRecordService(userId: string) {
  try {
    const record = await userRepository.findContinuingRecordByUserId(userId);
    return record
      ? { code: 200, status: "success", data: { record } }
      : { code: 404, status: "error", message: "Continuing student record not found" };
  } catch {
    return { code: 500, status: "error", message: "Unable to load continuing student record" };
  }
}

export async function changeStudentPasswordService(userId: string, currentPassword: string, newPassword: string) {
  try {
    const user = await userRepository.findByIdWithPassword(userId);
    if (!user || !(await bcrypt.compare(currentPassword, user.password))) {
      return { code: 400, status: "error", message: "Current password is incorrect" };
    }
    await userRepository.updatePassword(userId, await bcrypt.hash(newPassword, 10));
    return { code: 200, status: "success", message: "Password changed successfully" };
  } catch (error) {
    console.error("changeStudentPasswordService error", error);
    return { code: 500, status: "error", message: "Unable to change password" };
  }
}
