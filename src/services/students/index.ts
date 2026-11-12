import { UserRepository } from "@/repositories/user-repository";
import { StudentProfileRepository } from "@/repositories/student-profile-repository";
import { broadcastProfileUpdated } from "@/services/sse";

const userRepo = new UserRepository();
const profileRepo = new StudentProfileRepository();

export const getProfileService = async (userId: string) => {
  try {
    const user = await userRepo.findById(userId);
    if (!user) {
      return { code: 404, status: "error", message: "User not found" };
    }

    let profile = await profileRepo.findByUserId(userId);
    if (!profile) {
      profile = await profileRepo.createDefault(userId);
    }

    return {
      code: 200,
      status: "success",
      data: {
        profile: {
          studentId: user.studentNumber ?? "",
          fullName: user.name,
          program: user.course ?? "",
          yearLevel: user.yearLevel ?? null,
          section: "",
          enrollmentStatus: "Enrolled",
          avatarUrl: user.avatarUrl ?? null,
          email: user.email,
          phone: profile.phone ?? user.phone ?? "",
          alternateContact: profile.alternateContact ?? "",
          address: {
            street: profile.street ?? "",
            barangay: profile.barangay ?? "",
            city: profile.city ?? "",
            province: profile.province ?? "",
          },
          gender: profile.gender ?? "",
          dateOfBirth: profile.dateOfBirth ?? "",
          placeOfBirth: profile.placeOfBirth ?? "",
          civilStatus: profile.civilStatus ?? "",
          religion: profile.religion ?? "",
          nationality: profile.nationality ?? "",
          motherName: profile.motherName ?? "",
          fatherName: profile.fatherName ?? "",
          guardianName: profile.guardianName ?? "",
          guardianContact: profile.guardianContact ?? "",
          updatedAt: profile.updatedAt,
        },
      },
    };
  } catch (error) {
    console.error("getProfileService Error:", error);
    return { code: 500, status: "error", message: "Failed to fetch profile" };
  }
};

export const updateProfileService = async (
  userId: string,
  patch: Partial<{
    phone: string;
    alternateContact: string;
    street: string;
    barangay: string;
    city: string;
    province: string;
    gender: string;
    dateOfBirth: string;
    placeOfBirth: string;
    civilStatus: string;
    religion: string;
    nationality: string;
    motherName: string;
    fatherName: string;
    guardianName: string;
    guardianContact: string;
  }>
) => {
  try {
    const user = await userRepo.findById(userId);
    if (!user) {
      return { code: 404, status: "error", message: "User not found" };
    }

    if ((patch as any).avatarUrl) {
      await profileRepo.updateAvatarUrl(userId, (patch as any).avatarUrl);
    }

    await profileRepo.upsert(userId, patch);
    broadcastProfileUpdated(userId);

    // Return the full updated profile shape
    return getProfileService(userId);
  } catch (error) {
    console.error("updateProfileService Error:", error);
    return { code: 500, status: "error", message: "Failed to update profile" };
  }
};

export const updateAvatarService = async (userId: string, avatarUrl: string) => {
  try {
    if (!avatarUrl || typeof avatarUrl !== "string") {
      return { code: 400, status: "error", message: "avatarUrl is required" };
    }

    const result = await profileRepo.updateAvatarUrl(userId, avatarUrl);
    if (!result) {
      return { code: 404, status: "error", message: "User not found" };
    }
    broadcastProfileUpdated(userId);

    return {
      code: 200,
      status: "success",
      message: "Avatar updated",
      data: { avatarUrl: result.avatarUrl },
    };
  } catch (error) {
    console.error("updateAvatarService Error:", error);
    return { code: 500, status: "error", message: "Failed to update avatar" };
  }
};
