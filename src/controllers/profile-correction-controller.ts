import { Request, Response } from "express";
import type { AuthenticatedRequest } from "@/middlewares/auth-middleware";
import { sendResult } from "@/lib/api-response";
import {
  createProfileCorrectionService,
  decideProfileCorrectionService,
  listProfileCorrectionsService,
  listStudentProfileCorrectionsService,
} from "@/services/profile-corrections";

export class ProfileCorrectionController {
  public create = async (req: Request, res: Response) => {
    const studentUserId = (req as AuthenticatedRequest).user?.sub ?? "";
    const body = req.body ?? {};
    return sendResult(res, await createProfileCorrectionService(studentUserId, {
      field: body.field,
      currentValue: body.currentValue,
      requestedValue: body.correctValue,
      reason: body.reason,
      attachmentName: body.attachmentName,
      attachmentType: body.attachmentType,
      attachmentData: body.attachmentData,
    }));
  };

  public list = async (_req: Request, res: Response) =>
    sendResult(res, await listProfileCorrectionsService());

  public listMine = async (req: Request, res: Response) => {
    const studentUserId = (req as AuthenticatedRequest).user?.sub ?? "";
    return sendResult(res, await listStudentProfileCorrectionsService(studentUserId));
  };

  public decide = async (req: Request, res: Response) => {
    const reviewerId = (req as AuthenticatedRequest).user?.sub ?? "";
    const id = Array.isArray(req.params.id) ? req.params.id[0] ?? "" : req.params.id ?? "";
    return sendResult(res, await decideProfileCorrectionService(id, reviewerId, req.body ?? {}));
  };
}
