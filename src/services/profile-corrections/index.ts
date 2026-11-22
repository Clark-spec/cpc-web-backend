import { NotificationRepository } from "@/repositories/notification-repository";
import { ProfileCorrectionRepository, type ProfileCorrectionDecision, type ProfileCorrectionInput } from "@/repositories/profile-correction-repository";
import { UserRepository } from "@/repositories/user-repository";
import { broadcastNotificationCreated, broadcastProfileCorrectionUpdated, broadcastProfileUpdated } from "@/services/sse";

const correctionRepo = new ProfileCorrectionRepository();
const notificationRepo = new NotificationRepository();
const userRepo = new UserRepository();

export async function createProfileCorrectionService(studentUserId: string, input: ProfileCorrectionInput) {
  try {
    const request = await correctionRepo.create(studentUserId, input);
    if (!request) return { code: 404, status: "error", message: "Student account not found." };

    await notificationRepo.createForOffices(["registrar"], {
      title: "New Profile Correction Request",
      message: `${request.referenceNumber}: ${request.studentName} (${request.studentId}) requested a correction for ${request.field}.`,
      type: "info",
      href: "/admin/students/profile-corrections",
    });

    const staffIds = await userRepo.findIdsByRoles(["ADMIN", "REGISTRAR"]);
    for (const staffId of staffIds) {
      broadcastProfileCorrectionUpdated(staffId, request);
    }

    return { code: 201, status: "success", message: "Your correction request was sent to the Registrar.", data: { request } };
  } catch (error) {
    console.error("createProfileCorrectionService Error:", error);
    return { code: 500, status: "error", message: "Could not send the correction request. Please try again." };
  }
}

export async function listProfileCorrectionsService() {
  try {
    return { code: 200, status: "success", data: { requests: await correctionRepo.list() } };
  } catch (error) {
    console.error("listProfileCorrectionsService Error:", error);
    return { code: 500, status: "error", message: "Could not load correction requests." };
  }
}

export async function listStudentProfileCorrectionsService(studentUserId: string) {
  try {
    return { code: 200, status: "success", data: { requests: await correctionRepo.listByStudent(studentUserId) } };
  } catch (error) {
    console.error("listStudentProfileCorrectionsService Error:", error);
    return { code: 500, status: "error", message: "Could not load your correction requests." };
  }
}

export async function decideProfileCorrectionService(
  id: string,
  reviewerId: string,
  decision: ProfileCorrectionDecision,
) {
  try {
    const request = await correctionRepo.decide(id, decision, reviewerId);
    if (!request) return { code: 404, status: "error", message: "Correction request not found." };

    if (decision.status === "approved") broadcastProfileUpdated(request.studentUserId);

    const notification = await notificationRepo.create(request.studentUserId, {
      title: decision.status === "approved" ? "Profile Correction Approved" : "Profile Correction Update",
      message: decision.status === "approved"
        ? `Your correction request for ${request.field} was approved.`
        : `Your correction request for ${request.field} was not approved.${decision.adminRemarks ? ` Registrar's note: ${decision.adminRemarks}` : ""}`,
      type: decision.status === "approved" ? "success" : "warning",
      href: "/my-account/profile-corrections",
    });
    broadcastNotificationCreated(request.studentUserId, {
      id: notification.id,
      title: notification.title ?? null,
      message: notification.message,
      type: notification.type,
      href: notification.href ?? null,
      createdAt: notification.createdAt,
    });

    const staffIds = await userRepo.findIdsByRoles(["ADMIN", "REGISTRAR"]);
    for (const staffId of staffIds) broadcastProfileCorrectionUpdated(staffId, request);
    broadcastProfileCorrectionUpdated(request.studentUserId, request);

    return { code: 200, status: "success", message: "Correction request reviewed.", data: { request } };
  } catch (error) {
    console.error("decideProfileCorrectionService Error:", error);
    if ((error as { code?: number })?.code === 409) {
      return { code: 409, status: "error", message: (error as Error).message };
    }
    return { code: 500, status: "error", message: "Could not update the correction request." };
  }
}
