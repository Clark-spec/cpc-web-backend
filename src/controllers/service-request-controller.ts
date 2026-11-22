import { Request, Response } from "express";
import {
  getCatalogService,
  listRequestsService,
  createRequestService,
  getRequestService,
  getOwnedDocumentService,
  listAdminRequestsService,
  getAdminRequestService,
  updateServiceRequestService,
  getAdminDocumentService,
  getDraftService,
  saveDraftService,
  deleteDraftService,
} from "@/services/service-requests";
import { NotificationRepository } from "@/repositories/notification-repository";
import type { AuthenticatedRequest } from "@/middlewares/auth-middleware";
import { sendResult } from "@/lib/api-response";

const notifRepo = new NotificationRepository();

function requestId(req: Request): string {
  return Array.isArray(req.params.id) ? (req.params.id[0] ?? "") : (req.params.id ?? "");
}

/** Streams a stored base64 data URL as a real file download. */
function sendDocument(
  res: Response,
  document: { name: string; type: string; data: string },
) {
  const comma = document.data.indexOf(",");
  const base64 = comma >= 0 ? document.data.slice(comma + 1) : document.data;
  const buffer = Buffer.from(base64, "base64");
  const safeName = document.name.replace(/["\r\n]/g, "");

  res.setHeader("Content-Type", document.type);
  res.setHeader("Content-Disposition", `inline; filename="${safeName}"`);
  res.setHeader("Content-Length", String(buffer.length));
  return res.send(buffer);
}

export class ServiceRequestController {
  public getCatalog = async (_req: Request, res: Response) => {
    const result = await getCatalogService();
    return sendResult(res, result);
  };

  public listRequests = async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).user?.sub ?? "";
    const result = await listRequestsService(userId);
    return sendResult(res, result);
  };

  public createRequest = async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).user?.sub ?? "";
    const result = await createRequestService(userId, req.body ?? {});
    return sendResult(res, result);
  };

  public getNotifications = async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).user?.sub ?? "";
    const data = await notifRepo.findByUserId(userId);
    return sendResult(res, { code: 200, status: "success", data });
  };

  public markNotificationsRead = async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).user?.sub ?? "";
    await notifRepo.markAllAsRead(userId);
    return sendResult(res, {
      code: 200,
      status: "success",
      message: "Notifications marked as read",
    });
  };

  public getDraft = async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).user?.sub ?? "";
    const result = await getDraftService(userId);
    return sendResult(res, result);
  };

  public saveDraft = async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).user?.sub ?? "";
    const result = await saveDraftService(userId, req.body ?? {});
    return sendResult(res, result);
  };

  public deleteDraft = async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).user?.sub ?? "";
    const result = await deleteDraftService(userId);
    return sendResult(res, result);
  };

  public getRequest = async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).user?.sub ?? "";
    const result = await getRequestService(userId, requestId(req));
    return sendResult(res, result);
  };

  public getDocument = async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).user?.sub ?? "";
    const requestedIndex = Number(req.query.index ?? 0);
    const result = await getOwnedDocumentService(userId, requestId(req), Number.isInteger(requestedIndex) && requestedIndex >= 0 ? requestedIndex : 0);
    if (result.code !== 200 || !result.data) {
      return sendResult(res, result);
    }
    return sendDocument(res, result.data);
  };

  public listAdmin = async (req: Request, res: Response) => {
    const result = await listAdminRequestsService(req.query ?? {});
    return sendResult(res, result);
  };

  public getAdmin = async (req: Request, res: Response) => {
    const referenceNumber = typeof req.query.referenceNumber === "string" ? req.query.referenceNumber : undefined;
    const result = await getAdminRequestService(requestId(req), referenceNumber);
    return sendResult(res, result);
  };

  public updateAdmin = async (req: Request, res: Response) => {
    const user = (req as AuthenticatedRequest).user;
    const result = await updateServiceRequestService(requestId(req), req.body ?? {}, {
      id: user?.sub ?? "",
      role: user?.role ?? "",
    });
    return sendResult(res, result);
  };

  public getAdminDocument = async (req: Request, res: Response) => {
    const requestedIndex = Number(req.query.index ?? 0);
    const index = Number.isInteger(requestedIndex) && requestedIndex >= 0 ? requestedIndex : 0;
    const result = await getAdminDocumentService(requestId(req), index);
    if (result.code !== 200 || !result.data) {
      return sendResult(res, result);
    }
    return sendDocument(res, result.data);
  };
}
