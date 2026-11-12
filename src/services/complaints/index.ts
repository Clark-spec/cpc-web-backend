import {
  COMPLAINT_COOLDOWN_MS,
  ComplaintRepository,
  type NewComplaintInput,
} from "@/repositories/complaint-repository";
import { UserRepository } from "@/repositories/user-repository";
import { NotificationRepository } from "@/repositories/notification-repository";
import {
  broadcastComplaintUpdated,
  broadcastNotificationCreated,
  broadcastNotificationUpdated,
} from "@/services/sse";
import { COMPLAINT_COOLDOWN_HOURS } from "@/schema/complaint-schema";

const complaintRepo = new ComplaintRepository();
const userRepo = new UserRepository();
const notificationRepo = new NotificationRepository();

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  in_review: "In Review",
  resolved: "Resolved",
};

/** Strips markup and control characters before anything is stored. */
function sanitizeText(value: string, maxLength: number): string {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, maxLength);
}

function sanitizeFileName(value: string): string {
  return value.replace(/[\\/]/g, "").trim().slice(0, 255) || "attachment";
}

function humanizeRemaining(ms: number): string {
  const totalMinutes = Math.max(1, Math.ceil(ms / 60_000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(" ");
}

function formatYearLevel(value: unknown): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return "";
  const suffix =
    numeric === 1 ? "st" : numeric === 2 ? "nd" : numeric === 3 ? "rd" : "th";
  return `${numeric}${suffix} Year`;
}

function toStudentDto(row: any) {
  return {
    id: row.id,
    referenceNumber: row.referenceNumber,
    subject: row.subject,
    category: row.category,
    description: row.description,
    filedAt: row.createdAt,
    updatedAt: row.updatedAt,
    status: row.status,
    anonymous: row.isAnonymous === true,
    attachmentName: row.attachmentName ?? null,
    adminRemarks: row.adminRemarks ?? "",
  };
}

/**
 * Staff response shape. Anonymous complaints deliberately carry placeholders
 * instead of identity, and never a user id or submitter reference.
 */
function toAdminDto(row: any, includeAttachment = false) {
  const anonymous = row.isAnonymous === true;
  const dto: Record<string, unknown> = {
    id: row.id,
    referenceNumber: row.referenceNumber,
    subject: row.subject,
    category: row.category,
    description: row.description,
    status: row.status,
    anonymous,
    attachmentName: row.attachmentName ?? null,
    adminRemarks: row.adminRemarks ?? "",
    filedAt: row.createdAt,
    updatedAt: row.updatedAt,
    updatedByName: row.updatedByName ?? row.lastUpdatedByName ?? null,
    updatedByRole: row.lastUpdatedByRole ?? null,
    studentName: anonymous ? "Anonymous" : (row.studentName ?? ""),
    studentId: anonymous ? "Hidden" : (row.studentId ?? ""),
    program: anonymous ? "" : (row.program ?? ""),
    yearLevel: anonymous ? "" : formatYearLevel(row.yearLevel),
    email: anonymous ? "" : (row.email ?? ""),
  };

  if (includeAttachment) {
    dto.attachmentUrl = row.attachmentData ?? null;
  }

  return dto;
}

function cooldownState(lastSubmittedAt: string | null) {
  if (!lastSubmittedAt) {
    return { canSubmit: true, nextAllowedAt: null as string | null };
  }

  const nextAllowed = new Date(
    new Date(lastSubmittedAt).getTime() + COMPLAINT_COOLDOWN_MS,
  );
  const active = nextAllowed.getTime() > Date.now();

  return {
    canSubmit: !active,
    nextAllowedAt: active ? nextAllowed.toISOString() : null,
  };
}

/** Staff roles that receive new-complaint alerts in the admin bell. */
const COMPLAINT_ADMIN_ROLES = ["ADMIN", "REGISTRAR", "DEAN", "SAO"];

/**
 * Drops an update into the submitter's bell and pings their open tabs.
 * The text carries only the reference and status — never a name, course or
 * account id — so anonymous complaints stay anonymous. Notification failures
 * never roll back the admin's change.
 */
async function notifyStudentOfUpdate(
  complaintId: string,
  complaint:
    | { referenceNumber?: string; updatedAt?: string; adminRemarks?: string | null }
    | null
    | undefined,
  change: { statusChanged: boolean; status: string; responseAdded: boolean },
) {
  try {
    const submitterId = await complaintRepo.findSubmitterId(complaintId);
    if (!submitterId) return;

    const reference = complaint?.referenceNumber ?? "";
    const label = STATUS_LABELS[change.status] ?? change.status;
    const href = `/student/complaint-status?complaint=${encodeURIComponent(complaintId)}`;

    let title = "Complaint Status Updated";
    let message = reference
      ? `Complaint ${reference} is now ${label}.`
      : `Your complaint status is now ${label}.`;
    let type: "info" | "success" = "info";

    if (change.statusChanged && change.status === "resolved") {
      title = "Complaint Resolved";
      type = "success";
    }

    if (change.statusChanged && change.responseAdded) {
      message += " Student Support added a response.";
    } else if (!change.statusChanged && change.responseAdded) {
      title = "New Response from Student Support";
      message = reference
        ? `Student Support replied to complaint ${reference}.`
        : "Student Support replied to your complaint.";
    }

    const notification = await notificationRepo.create(submitterId, {
      title,
      message,
      type,
      href,
    });
    // Push the finished bell item itself so the badge and panel update the
    // instant the office saves, without the student's tab refetching.
    broadcastNotificationCreated(submitterId, {
      id: notification.id,
      title: notification.title ?? null,
      message: notification.message,
      type: notification.type,
      href: notification.href ?? null,
      createdAt: notification.createdAt,
    });
    // Only the owning student's channel receives this; the payload carries no
    // identity, just what the list needs to patch the row in place.
    broadcastComplaintUpdated(submitterId, {
      complaintId,
      status: change.status,
      updatedAt: complaint?.updatedAt ?? new Date().toISOString(),
      adminRemarks: complaint?.adminRemarks ?? "",
    });
  } catch (error) {
    console.error("notifyStudentOfUpdate Error:", error);
  }
}

/** Bell alert for every complaint-handling admin. Identity-free by design. */
async function notifyAdminsOfNewComplaint(
  complaint:
    | { referenceNumber?: string; isAnonymous?: boolean }
    | null
    | undefined,
) {
  try {
    const adminIds = await userRepo.findIdsByRoles(COMPLAINT_ADMIN_ROLES);
    if (adminIds.length === 0) return;

    const reference = complaint?.referenceNumber ?? "a new complaint";
    const message = complaint?.isAnonymous
      ? `A new anonymous complaint ${reference} was submitted.`
      : `A new complaint ${reference} was submitted.`;

    await Promise.all(
      adminIds.map((adminId) =>
        notificationRepo.create(adminId, {
          title: "New Complaint Submitted",
          message,
          type: "info",
          href: "/admin/support/complaints",
        }),
      ),
    );
    adminIds.forEach((adminId) => broadcastNotificationUpdated(adminId));
  } catch (error) {
    console.error("notifyAdminsOfNewComplaint Error:", error);
  }
}

// ─── Student services ────────────────────────────────────────────────────────

export const listMyComplaintsService = async (userId: string) => {
  try {
    const [rows, lastSubmittedAt] = await Promise.all([
      complaintRepo.findByUserId(userId),
      complaintRepo.getLastSubmittedAt(userId),
    ]);
    const { canSubmit, nextAllowedAt } = cooldownState(lastSubmittedAt);

    return {
      code: 200,
      status: "success",
      data: {
        complaints: rows.map(toStudentDto),
        canSubmit,
        nextAllowedAt,
        cooldownHours: COMPLAINT_COOLDOWN_HOURS,
        serverTime: new Date().toISOString(),
      },
    };
  } catch (error) {
    console.error("listMyComplaintsService Error:", error);
    return { code: 500, status: "error", message: "Failed to fetch complaints" };
  }
};

export const createComplaintService = async (userId: string, body: any) => {
  try {
    const input: NewComplaintInput = {
      subject: sanitizeText(String(body.subject ?? ""), 120),
      category: String(body.category ?? ""),
      description: sanitizeText(String(body.description ?? ""), 2000),
      isAnonymous: body.isAnonymous === true,
      attachment: body.attachment
        ? {
            name: sanitizeFileName(String(body.attachment.name ?? "")),
            type: String(body.attachment.type ?? ""),
            size: Number(body.attachment.size),
            data: String(body.attachment.data ?? ""),
          }
        : null,
    };

    const result = await complaintRepo.create(userId, input);

    if (result.kind === "cooldown") {
      const remaining = new Date(result.nextAllowedAt).getTime() - Date.now();
      return {
        code: 429,
        status: "error",
        message: `You can submit another complaint in ${humanizeRemaining(remaining)}.`,
        data: {
          canSubmit: false,
          nextAllowedAt: result.nextAllowedAt,
        },
      };
    }

    await notifyAdminsOfNewComplaint(result.complaint);

    return {
      code: 201,
      status: "success",
      message: "Complaint submitted",
      data: { complaint: toStudentDto(result.complaint) },
    };
  } catch (error) {
    console.error("createComplaintService Error:", error);
    return { code: 500, status: "error", message: "Failed to submit complaint" };
  }
};

// ─── Admin services ──────────────────────────────────────────────────────────

export const listAdminComplaintsService = async (query: any) => {
  try {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(500, Math.max(1, Number(query.pageSize) || 10));
    const status = query.status === "all" ? undefined : query.status;
    const category = query.category === "all" ? undefined : query.category;
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;

    const filters = {
      page,
      pageSize,
      search: typeof query.search === "string" ? query.search : undefined,
      status,
      category,
      from: datePattern.test(query.from ?? "") ? query.from : undefined,
      to: datePattern.test(query.to ?? "") ? query.to : undefined,
    };

    const [{ rows, total }, summary] = await Promise.all([
      complaintRepo.findAdminPage(filters),
      complaintRepo.getSummary(),
    ]);

    return {
      code: 200,
      status: "success",
      data: {
        complaints: rows.map((row) => toAdminDto(row)),
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.max(1, Math.ceil(total / pageSize)),
        },
        summary,
        serverTime: new Date().toISOString(),
      },
    };
  } catch (error) {
    console.error("listAdminComplaintsService Error:", error);
    return { code: 500, status: "error", message: "Failed to fetch complaints" };
  }
};

export const getAdminComplaintService = async (id: string) => {
  try {
    const row = await complaintRepo.findAdminById(id);
    if (!row) {
      return { code: 404, status: "error", message: "Complaint not found" };
    }

    return {
      code: 200,
      status: "success",
      data: { complaint: toAdminDto(row, true) },
    };
  } catch (error) {
    console.error("getAdminComplaintService Error:", error);
    return { code: 500, status: "error", message: "Failed to fetch complaint" };
  }
};

export const updateComplaintService = async (
  id: string,
  body: any,
  admin: { id: string; role: string },
) => {
  try {
    const adminUser = await userRepo.findById(admin.id);
    // The memory repo mutates its rows in place, so capture the previous
    // status/remarks as values before update() runs.
    const previous = await complaintRepo.findAdminById(id);
    const previousStatus = previous?.status ?? null;
    const previousRemarks = previous?.adminRemarks ?? "";
    const adminRemarks =
      body.adminRemarks !== undefined
        ? sanitizeText(String(body.adminRemarks), 500)
        : undefined;

    const result = await complaintRepo.update(
      id,
      {
        status: body.status,
        adminRemarks,
        expectedUpdatedAt:
          typeof body.expectedUpdatedAt === "string"
            ? body.expectedUpdatedAt
            : undefined,
      },
      { id: admin.id, role: admin.role, name: adminUser?.name ?? admin.role },
    );

    if (result.kind === "not_found") {
      return { code: 404, status: "error", message: "Complaint not found" };
    }

    if (result.kind === "conflict") {
      const current = await complaintRepo.findAdminById(id);
      return {
        code: 409,
        status: "error",
        message:
          "This complaint was updated by another administrator. Reopen it to see the latest changes.",
        data: current ? { complaint: toAdminDto(current) } : undefined,
      };
    }

    const statusChanged = Boolean(
      previousStatus && body.status && previousStatus !== body.status,
    );
    const responseAdded =
      adminRemarks !== undefined &&
      adminRemarks !== previousRemarks &&
      adminRemarks.trim().length > 0;

    if (statusChanged || responseAdded) {
      await notifyStudentOfUpdate(id, result.complaint, {
        statusChanged,
        status: body.status || previousStatus || "pending",
        responseAdded,
      });
    }

    const row = await complaintRepo.findAdminById(id);
    return {
      code: 200,
      status: "success",
      message: "Complaint updated",
      data: { complaint: row ? toAdminDto(row) : null },
    };
  } catch (error) {
    console.error("updateComplaintService Error:", error);
    return { code: 500, status: "error", message: "Failed to update complaint" };
  }
};
