import { Request, Response } from "express";
import { getCatalogService, listRequestsService, createRequestService, getRequestService } from "@/services/service-requests";
import { NotificationRepository } from "@/repositories/notification-repository";
import type { AuthenticatedRequest } from "@/middlewares/auth-middleware";

const notifRepo = new NotificationRepository();

export class ServiceRequestController {
  public getCatalog = async (_req: Request, res: Response) => {
    const result = await getCatalogService();
    return res.status(result.code).json(result);
  };

  public listRequests = async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).user?.sub ?? "";
    const result = await listRequestsService(userId);
    return res.status(result.code).json(result);
  };

  public createRequest = async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).user?.sub ?? "";
    const result = await createRequestService(userId, req.body ?? {});
    return res.status(result.code).json(result);
  };

  public getNotifications = async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).user?.sub ?? "";
    const data = await notifRepo.findByUserId(userId);
    return res.status(200).json({
      code: 200,
      status: "success",
      data,
    });
  };

  public markNotificationsRead = async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).user?.sub ?? "";
    await notifRepo.markAllAsRead(userId);
    return res.status(200).json({
      code: 200,
      status: "success",
      message: "Notifications marked as read",
    });
  };

  public getDraft = async (_req: Request, res: Response) => {
    return res.status(200).json({
      code: 200,
      status: "success",
      data: { draft: null },
    });
  };

  public saveDraft = async (req: Request, res: Response) => {
    return res.status(200).json({
      code: 200,
      status: "success",
      message: "Draft saved",
      data: { draft: req.body ?? null },
    });
  };

  public deleteDraft = async (_req: Request, res: Response) => {
    return res.status(200).json({
      code: 200,
      status: "success",
      message: "Draft deleted",
    });
  };

  public getRequest = async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).user?.sub ?? "";
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const result = await getRequestService(userId, id ?? "");
    return res.status(result.code).json(result);
  };
}
