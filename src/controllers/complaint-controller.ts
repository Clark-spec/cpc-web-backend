import { Request, Response } from "express";
import type { AuthenticatedRequest } from "@/middlewares/auth-middleware";
import { sendResult } from "@/lib/api-response";
import {
  createComplaintService,
  getAdminComplaintService,
  listAdminComplaintsService,
  listMyComplaintsService,
  updateComplaintService,
} from "@/services/complaints";

export class ComplaintController {
  public listMine = async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).user?.sub ?? "";
    const result = await listMyComplaintsService(userId);
    return sendResult(res, result);
  };

  public create = async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).user?.sub ?? "";
    const result = await createComplaintService(userId, req.body ?? {});
    return sendResult(res, result);
  };

  public listForAdmin = async (req: Request, res: Response) => {
    const result = await listAdminComplaintsService(req.query ?? {});
    return sendResult(res, result);
  };

  public getForAdmin = async (req: Request, res: Response) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const result = await getAdminComplaintService(id ?? "");
    return sendResult(res, result);
  };

  public update = async (req: Request, res: Response) => {
    const user = (req as AuthenticatedRequest).user!;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const result = await updateComplaintService(id ?? "", req.body ?? {}, {
      id: user.sub,
      role: user.role,
    });
    return sendResult(res, result);
  };
}
