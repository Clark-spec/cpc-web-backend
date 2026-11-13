import {
  ServiceCatalogRepository,
  ServiceRequestRepository,
  normalizeRequestStatus,
  SERVICE_REQUEST_STATUS_LABELS,
  type ServiceRequestAttachmentInput,
  type ServiceRequestStatus,
} from "@/repositories/service-request-repository";
import { UserRepository } from "@/repositories/user-repository";
import { NotificationRepository } from "@/repositories/notification-repository";
import {
  broadcastNotificationCreated,
  broadcastNotificationUpdated,
  broadcastServiceRequestUpdated,
  broadcastToUser,
} from "@/services/sse";

const catalogRepo = new ServiceCatalogRepository();
const requestRepo = new ServiceRequestRepository();
const userRepo = new UserRepository();
const notificationRepo = new NotificationRepository();

/** Staff roles that own Student Services > Service Requests. */
const SERVICE_REQUEST_ADMIN_ROLES = ["ADMIN", "REGISTRAR", "DEAN", "SAO"];

const STAGE_KEYS: Exclude<ServiceRequestStatus, "rejected">[] = [
  "submitted",
  "under_review",
  "processing",
  "ready_for_release",
  "released",
];

const STAGE_COPY: Record<string, { label: string; description: string }> = {
  submitted: { label: "Submitted", description: "Your request has been received." },
  under_review: { label: "Under Review", description: "Student services is reviewing your request." },
  processing: { label: "Processing", description: "In progress at service office" },
  ready_for_release: { label: "Ready for Release", description: "Waiting for document release" },
  released: { label: "Released", description: "Document released to the student." },
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

function formatDocument(req: any) {
  if (!req?.attachmentName) return null;
  return {
    name: req.attachmentName,
    size: req.attachmentSize ?? 0,
    mime: req.attachmentType ?? "",
  };
}

function formatHistory(rows: any[]) {
  return rows.map((row) => {
    const status = normalizeRequestStatus(row.newStatus);
    return {
      id: row.id,
      oldStatus: row.oldStatus ? normalizeRequestStatus(row.oldStatus) : null,
      status,
      statusLabel: SERVICE_REQUEST_STATUS_LABELS[status],
      remarks: row.remarks ?? "",
      changedByName: row.changedByName ?? null,
      changedByRole: row.changedByRole ?? null,
      changedAt: row.createdAt,
    };
  });
}

/**
 * Timeline is derived from the history rows, so the student sees exactly the
 * stages the office actually moved through. Legacy rows without history fall
 * back to the current status timestamp.
 */
function buildTimeline(status: ServiceRequestStatus, history: any[], req: any) {
  const timestamps: Record<string, string> = {};
  for (const entry of history) {
    const key = normalizeRequestStatus(entry.newStatus);
    if (key !== "rejected" && !timestamps[key]) timestamps[key] = entry.createdAt;
  }
  if (!timestamps.submitted && req?.submittedAt) timestamps.submitted = req.submittedAt;

  const currentIndex = STAGE_KEYS.indexOf(status as Exclude<ServiceRequestStatus, "rejected">);

  return STAGE_KEYS.map((key, index) => {
    let state: "completed" | "active" | "pending";
    if (status === "released") state = "completed";
    else if (status === "rejected") state = index === 0 ? "completed" : "pending";
    else if (index < currentIndex) state = "completed";
    else if (index === currentIndex) state = "active";
    else state = "pending";

    return {
      key,
      label: STAGE_COPY[key].label,
      description: STAGE_COPY[key].description,
      state,
      timestamp:
        state === "pending"
          ? null
          : (timestamps[key] ?? (key === status ? (req?.updatedAt ?? null) : null)),
    };
  });
}

function formatRequest(req: any, history?: any[]) {
  const status = normalizeRequestStatus(req.status);
  const base: Record<string, unknown> = {
    id: req.id,
    referenceNumber: req.referenceNumber,
    service: req.service,
    copies: req.copies,
    purpose: req.purpose ?? "",
    notes: req.notes ?? "",
    remarks: req.remarks ?? "",
    status,
    statusLabel: SERVICE_REQUEST_STATUS_LABELS[status],
    submittedAt: req.submittedAt,
    updatedAt: req.updatedAt,
    document: formatDocument(req),
    lastUpdatedByRole: req.lastUpdatedByRole ?? null,
    lastUpdatedByName: req.lastUpdatedByName ?? null,
  };

  if (history) {
    base.timeline = buildTimeline(status, history, req);
    base.history = formatHistory(history);
  }

  return base;
}

function toAdminDto(req: any, history?: any[]) {
  return {
    ...formatRequest(req, history),
    student: {
      name: req.studentName ?? "",
      studentNumber: req.studentNumber ?? "",
      course: req.course ?? "",
      yearLevel: req.yearLevel ?? null,
      email: req.email ?? "",
    },
  };
}

/** Bell alert for every office that handles service requests. */
async function notifyAdminsOfNewRequest(referenceNumber: string, serviceName: string) {
  try {
    const adminIds = await userRepo.findIdsByRoles(SERVICE_REQUEST_ADMIN_ROLES);
    if (adminIds.length === 0) return;

    await Promise.all(
      adminIds.map((adminId) =>
        notificationRepo.create(adminId, {
          title: "New Service Request",
          message: `New service request ${referenceNumber} (${serviceName}) was submitted.`,
          type: "info",
          href: "/admin/service-requests",
        }),
      ),
    );
    adminIds.forEach((adminId) => broadcastNotificationUpdated(adminId));
  } catch (error) {
    console.error("notifyAdminsOfNewRequest Error:", error);
  }
}

/**
 * Drops a bell item into the owner's feed and patches their open Request Status
 * views. The payload carries no identity — only what the list and modal need.
 */
async function notifyStudentOfRequestUpdate(
  row: any,
  history: any[],
  historyEntry: any,
  change: { statusChanged: boolean; remarksChanged: boolean },
) {
  try {
    const studentId: string | undefined = row?.userId;
    if (!studentId) return;

    const status = normalizeRequestStatus(row.status);
    const reference = row.referenceNumber ?? "";
    const serviceName = row.service?.name ?? "";

    let title = "Service Request Update";
    let message = reference
      ? `Your service request #${reference}${serviceName ? ` (${serviceName})` : ""} is now ${SERVICE_REQUEST_STATUS_LABELS[status]}.`
      : `Your service request is now ${SERVICE_REQUEST_STATUS_LABELS[status]}.`;
    let type: "info" | "success" | "warning" = "info";

    if (change.statusChanged && status === "released") {
      title = "Service Request Released";
      type = "success";
    } else if (change.statusChanged && status === "rejected") {
      title = "Service Request Rejected";
      type = "warning";
    } else if (!change.statusChanged && change.remarksChanged) {
      title = "New Remarks on Your Service Request";
      message = reference
        ? `The office added remarks to your service request #${reference}${serviceName ? ` (${serviceName})` : ""}.`
        : "The office added remarks to your service request.";
    }

    const notification = await notificationRepo.create(studentId, {
      title,
      message,
      type,
      href: `/student/request-status?request=${encodeURIComponent(row.id)}`,
    });
    broadcastNotificationCreated(studentId, {
      id: notification.id,
      title: notification.title ?? null,
      message: notification.message,
      type: notification.type,
      href: notification.href ?? null,
      createdAt: notification.createdAt,
    });

    broadcastServiceRequestUpdated(studentId, {
      requestId: row.id,
      referenceNumber: reference,
      status,
      statusLabel: SERVICE_REQUEST_STATUS_LABELS[status],
      updatedAt: row.updatedAt,
      remarks: row.remarks ?? "",
      timeline: buildTimeline(status, history, row),
      historyEntry:
        formatHistory(
          historyEntry
            ? [...history.filter((entry) => entry.id !== historyEntry.id), historyEntry]
            : [],
        ).at(-1) ?? null,
    });
  } catch (error) {
    console.error("notifyStudentOfRequestUpdate Error:", error);
  }
}

// ─── Catalog ────────────────────────────────────────────────────────────────

export const getCatalogService = async () => {
  try {
    await catalogRepo.seedCatalogIfEmpty();
    const [svcs, purps] = await Promise.all([
      catalogRepo.getAllServices(),
      catalogRepo.getAllPurposes(),
    ]);

    return {
      code: 200,
      status: "success",
      data: {
        services: svcs,
        purposes: purps.map((p) => p.label),
      },
    };
  } catch (error) {
    console.error("getCatalogService Error:", error);
    return { code: 500, status: "error", message: "Failed to fetch catalog" };
  }
};

// ─── Drafts ─────────────────────────────────────────────────────────────────

/** Student-facing shape; the attachment bytes never leave the server. */
function formatDraft(draft: any) {
  if (!draft) return null;
  const hasDocument = Boolean(draft.attachmentName);
  return {
    service_id: draft.serviceId ?? null,
    copies: draft.copies ?? 1,
    purpose: draft.purpose ?? "",
    notes: draft.notes ?? "",
    has_document: hasDocument,
    document: hasDocument
      ? {
          name: draft.attachmentName,
          type: draft.attachmentType ?? "",
          size: draft.attachmentSize ?? 0,
        }
      : null,
    updated_at: draft.updatedAt,
  };
}

export const getDraftService = async (userId: string) => {
  try {
    const draft = await requestRepo.findDraftByUserId(userId);
    return { code: 200, status: "success", data: { draft: formatDraft(draft) } };
  } catch (error) {
    console.error("getDraftService Error:", error);
    return { code: 500, status: "error", message: "Failed to load draft" };
  }
};

export const saveDraftService = async (userId: string, body: any) => {
  try {
    const rawServiceId = body.serviceId;
    const serviceId =
      rawServiceId === null || rawServiceId === undefined || rawServiceId === ""
        ? null
        : Number(rawServiceId);

    if (serviceId !== null && (!Number.isInteger(serviceId) || serviceId <= 0)) {
      return { code: 400, status: "error", message: "Select a valid service" };
    }
    if (serviceId !== null) {
      const svc = await catalogRepo.findServiceById(serviceId);
      if (!svc || !svc.active) {
        return { code: 404, status: "error", message: "Service not found or inactive" };
      }
    }

    const copies = Math.min(10, Math.max(1, Math.trunc(Number(body.copies) || 1)));
    const purpose = sanitizeText(String(body.purpose ?? ""), 120);
    const notes = sanitizeText(String(body.notes ?? ""), 1000);

    const existing = await requestRepo.findDraftByUserId(userId);
    let attachment: ServiceRequestAttachmentInput | null = null;
    if (body.attachment) {
      attachment = {
        name: sanitizeFileName(String(body.attachment.name ?? "")),
        type: String(body.attachment.type ?? ""),
        size: Number(body.attachment.size),
        data: String(body.attachment.data ?? ""),
      };
    } else if (!body.removeAttachment && existing?.attachmentName) {
      // Keep the photo already stored so a second save does not drop it.
      attachment = {
        name: existing.attachmentName,
        type: existing.attachmentType ?? "",
        size: existing.attachmentSize ?? 0,
        data: existing.attachmentData ?? "",
      };
    }

    const saved = await requestRepo.saveDraft(userId, {
      serviceId,
      copies,
      purpose,
      notes,
      attachment,
    });

    return {
      code: 200,
      status: "success",
      message: "Draft saved",
      data: { draft: formatDraft(saved) },
    };
  } catch (error) {
    console.error("saveDraftService Error:", error);
    return { code: 500, status: "error", message: "Failed to save draft" };
  }
};

export const deleteDraftService = async (userId: string) => {
  try {
    await requestRepo.deleteDraftByUserId(userId);
    return { code: 200, status: "success", message: "Draft deleted" };
  } catch (error) {
    console.error("deleteDraftService Error:", error);
    return { code: 500, status: "error", message: "Failed to delete draft" };
  }
};

// ─── Student services ───────────────────────────────────────────────────────

export const listRequestsService = async (userId: string) => {
  try {
    const requests = await requestRepo.findByUserId(userId);
    return {
      code: 200,
      status: "success",
      data: {
        requests: requests.map((request) => formatRequest(request)),
      },
    };
  } catch (error) {
    console.error("listRequestsService Error:", error);
    return { code: 500, status: "error", message: "Failed to fetch requests" };
  }
};

export const createRequestService = async (
  userId: string,
  body: any,
) => {
  try {
    const serviceId = Number(body.serviceId);
    const copies = Math.min(10, Math.max(1, Math.trunc(Number(body.copies) || 1)));
    const purpose = sanitizeText(String(body.purpose ?? ""), 120);
    const notes = sanitizeText(String(body.notes ?? ""), 1000);

    if (!Number.isInteger(serviceId) || serviceId <= 0) {
      return { code: 400, status: "error", message: "serviceId is required" };
    }
    if (!purpose) {
      return { code: 400, status: "error", message: "Purpose is required" };
    }

    const svc = await catalogRepo.findServiceById(serviceId);
    if (!svc || !svc.active) {
      return { code: 404, status: "error", message: "Service not found or inactive" };
    }

    const purposes = await catalogRepo.getAllPurposes();
    if (!purposes.some((option) => option.label === purpose)) {
      return { code: 400, status: "error", message: "Select a valid purpose" };
    }

    const attachment = body.attachment
      ? {
          name: sanitizeFileName(String(body.attachment.name ?? "")),
          type: String(body.attachment.type ?? ""),
          size: Number(body.attachment.size),
          data: String(body.attachment.data ?? ""),
        }
      : null;

    const result = await requestRepo.create(userId, {
      serviceId,
      copies,
      purpose,
      notes,
      attachment,
    });

    if (result.kind === "duplicate") {
      const existing = await requestRepo.findByIdAndUserId(result.request.id, userId);
      return {
        code: 200,
        status: "success",
        message: "This request was already submitted.",
        data: { request: formatRequest(existing ?? result.request) },
      };
    }

    const [full, history] = await Promise.all([
      requestRepo.findByIdAndUserId(result.request.id, userId),
      requestRepo.findHistory(result.request.id),
    ]);

    // The submitted request replaces whatever was still in the draft slot.
    void requestRepo.deleteDraftByUserId(userId).catch(() => {});

    void notifyAdminsOfNewRequest(full?.referenceNumber ?? result.request.referenceNumber, svc.name);
    // Other tabs of the same student refresh their list without a page reload.
    broadcastToUser(userId, {
      event: "service_request_updated",
      data: {
        requestId: result.request.id,
        referenceNumber: result.request.referenceNumber,
        status: "submitted",
        statusLabel: SERVICE_REQUEST_STATUS_LABELS.submitted,
        updatedAt: result.request.submittedAt ?? new Date().toISOString(),
        remarks: "",
        timeline: [],
        historyEntry: null,
      },
    });

    return {
      code: 201,
      status: "success",
      message: "Service request submitted",
      data: { request: formatRequest(full ?? result.request, history) },
    };
  } catch (error) {
    console.error("createRequestService Error:", error);
    return { code: 500, status: "error", message: "Failed to create request" };
  }
};

export const getRequestService = async (userId: string, id: string) => {
  try {
    const req = await requestRepo.findByIdAndUserId(id, userId);
    if (!req) {
      return { code: 404, status: "error", message: "Request not found" };
    }

    const history = await requestRepo.findHistory(id);

    return {
      code: 200,
      status: "success",
      data: { request: formatRequest(req, history) },
    };
  } catch (error) {
    console.error("getRequestService Error:", error);
    return { code: 500, status: "error", message: "Failed to fetch request" };
  }
};

export const getOwnedDocumentService = async (userId: string, id: string) => {
  try {
    const req = await requestRepo.findByIdAndUserId(id, userId);
    if (!req) {
      return { code: 404, status: "error", message: "Request not found" };
    }
    if (!(req as any).attachmentData) {
      return { code: 404, status: "error", message: "No document attached to this request" };
    }
    return {
      code: 200,
      status: "success",
      data: {
        name: req.attachmentName ?? "student-id",
        type: req.attachmentType ?? "application/octet-stream",
        data: (req as any).attachmentData as string,
      },
    };
  } catch (error) {
    console.error("getOwnedDocumentService Error:", error);
    return { code: 500, status: "error", message: "Failed to fetch document" };
  }
};

// ─── Admin services ─────────────────────────────────────────────────────────

export const listAdminRequestsService = async (query: any) => {
  try {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(500, Math.max(1, Number(query.pageSize) || 10));
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    const status = query.status === "all" ? undefined : query.status;
    const serviceId = Number(query.serviceId);

    const filters = {
      page,
      pageSize,
      search: typeof query.search === "string" ? query.search : undefined,
      status,
      serviceId: Number.isInteger(serviceId) && serviceId > 0 ? serviceId : undefined,
      from: datePattern.test(query.from ?? "") ? query.from : undefined,
      to: datePattern.test(query.to ?? "") ? query.to : undefined,
    };

    const [{ rows, total }, summary] = await Promise.all([
      requestRepo.findAdminPage(filters),
      requestRepo.getAdminSummary(),
    ]);

    return {
      code: 200,
      status: "success",
      data: {
        requests: rows.map((row) => toAdminDto(row)),
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
    console.error("listAdminRequestsService Error:", error);
    return { code: 500, status: "error", message: "Failed to fetch requests" };
  }
};

export const getAdminRequestService = async (id: string) => {
  try {
    const row = await requestRepo.findAdminById(id);
    if (!row) {
      return { code: 404, status: "error", message: "Request not found" };
    }

    const history = await requestRepo.findHistory(id);
    return {
      code: 200,
      status: "success",
      data: { request: toAdminDto(row, history) },
    };
  } catch (error) {
    console.error("getAdminRequestService Error:", error);
    return { code: 500, status: "error", message: "Failed to fetch request" };
  }
};

export const updateServiceRequestService = async (
  id: string,
  body: any,
  admin: { id: string; role: string },
) => {
  try {
    const adminUser = await userRepo.findById(admin.id);
    // The memory repo mutates rows in place, so capture the previous values.
    const previous = await requestRepo.findAdminById(id);
    const previousStatus = previous ? normalizeRequestStatus(previous.status) : null;
    const previousRemarks = previous?.remarks ?? "";
    const remarks =
      body.remarks !== undefined ? sanitizeText(String(body.remarks), 500) : undefined;

    const result = await requestRepo.update(
      id,
      {
        status: body.status,
        remarks,
        expectedUpdatedAt:
          typeof body.expectedUpdatedAt === "string" ? body.expectedUpdatedAt : undefined,
      },
      { id: admin.id, role: admin.role, name: adminUser?.name ?? admin.role },
    );

    if (result.kind === "not_found") {
      return { code: 404, status: "error", message: "Request not found" };
    }

    if (result.kind === "conflict") {
      const current = await requestRepo.findAdminById(id);
      return {
        code: 409,
        status: "error",
        message:
          "This request was updated by another administrator. Reopen it to see the latest changes.",
        data: current ? { request: toAdminDto(current) } : undefined,
      };
    }

    const [row, history] = await Promise.all([
      requestRepo.findAdminById(id),
      requestRepo.findHistory(id),
    ]);

    const nextStatus = normalizeRequestStatus(result.request.status);
    const statusChanged = previousStatus !== null && previousStatus !== nextStatus;
    const remarksChanged =
      remarks !== undefined && remarks !== previousRemarks && remarks.length > 0;

    if (result.historyEntry && (statusChanged || remarksChanged) && row) {
      await notifyStudentOfRequestUpdate(row, history, result.historyEntry, {
        statusChanged,
        remarksChanged,
      });
    }

    return {
      code: 200,
      status: "success",
      message: "Request updated",
      data: { request: row ? toAdminDto(row, history) : null },
    };
  } catch (error) {
    console.error("updateServiceRequestService Error:", error);
    return { code: 500, status: "error", message: "Failed to update request" };
  }
};

export const getAdminDocumentService = async (id: string) => {
  try {
    const row = await requestRepo.findAdminById(id);
    if (!row) {
      return { code: 404, status: "error", message: "Request not found" };
    }
    if (!(row as any).attachmentData) {
      return { code: 404, status: "error", message: "No document attached to this request" };
    }
    return {
      code: 200,
      status: "success",
      data: {
        name: row.attachmentName ?? "student-id",
        type: row.attachmentType ?? "application/octet-stream",
        data: (row as any).attachmentData as string,
      },
    };
  } catch (error) {
    console.error("getAdminDocumentService Error:", error);
    return { code: 500, status: "error", message: "Failed to fetch document" };
  }
};
