import { ServiceCatalogRepository, ServiceRequestRepository } from "@/repositories/service-request-repository";
import { broadcastToUser } from "@/services/sse";

const catalogRepo = new ServiceCatalogRepository();
const requestRepo = new ServiceRequestRepository();

const STATUS_LABELS: Record<string, string> = {
  submitted: "Submitted",
  processing: "Processing",
  ready: "Ready for Pick-up",
  completed: "Completed",
  rejected: "Rejected",
};

function formatRequest(req: any) {
  return {
    id: req.id,
    referenceNumber: req.referenceNumber,
    service: req.service,
    copies: req.copies,
    purpose: req.purpose,
    notes: req.notes,
    remarks: req.remarks ?? null,
    status: req.status,
    statusLabel: STATUS_LABELS[req.status] ?? req.status,
    submittedAt: req.submittedAt,
    updatedAt: req.updatedAt,
  };
}

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

export const listRequestsService = async (userId: string) => {
  try {
    const requests = await requestRepo.findByUserId(userId);
    return {
      code: 200,
      status: "success",
      data: {
        requests: requests.map(formatRequest),
      },
    };
  } catch (error) {
    console.error("listRequestsService Error:", error);
    return { code: 500, status: "error", message: "Failed to fetch requests" };
  }
};

export const createRequestService = async (
  userId: string,
  body: { serviceId: number; copies?: number; purpose?: string; notes?: string }
) => {
  try {
    const { serviceId, copies = 1, purpose = "", notes = "" } = body;

    if (!serviceId) {
      return { code: 400, status: "error", message: "serviceId is required" };
    }

    const svc = await catalogRepo.findServiceById(serviceId);
    if (!svc || !svc.active) {
      return { code: 404, status: "error", message: "Service not found or inactive" };
    }

    const total = await requestRepo.getTotalCount();
    const year = new Date().getFullYear();
    const refNumber = `SR-${year}-${String(total + 1).padStart(6, "0")}`;

    const created = await requestRepo.create({
      referenceNumber: refNumber,
      userId,
      serviceId,
      copies,
      purpose,
      notes,
    });

    // Fetch full record with join
    const full = await requestRepo.findByIdAndUserId(created.id, userId);

    broadcastToUser(userId, {
      event: "service_request_updated",
      data: { id: created.id, referenceNumber: refNumber },
    });

    return {
      code: 201,
      status: "success",
      message: "Service request submitted",
      data: { request: formatRequest(full) },
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

    return {
      code: 200,
      status: "success",
      data: { request: formatRequest(req) },
    };
  } catch (error) {
    console.error("getRequestService Error:", error);
    return { code: 500, status: "error", message: "Failed to fetch request" };
  }
};
