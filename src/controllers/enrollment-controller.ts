import { Request, Response } from "express";
import type { AuthenticatedRequest } from "@/middlewares/auth-middleware";
import { sendResult } from "@/lib/api-response";
import {
  getOfficeSignatureRequests,
  getOwnEnrollmentSession,
  requestOfficeSignature,
  signEnrollmentStep,
  submitEnrollmentSession,
} from "@/services/enrollment";

export class EnrollmentController {
  public mine = async (req: Request, res: Response) => {
    const user = (req as AuthenticatedRequest).user;
    if (!user) return sendResult(res, { code: 401, message: "Please sign in to continue." });
    return sendResult(res, await getOwnEnrollmentSession(user.sub));
  };

  public officeRequests = async (req: Request, res: Response) => {
    const user = (req as AuthenticatedRequest).user;
    if (!user) return sendResult(res, { code: 401, message: "Please sign in to continue." });
    return sendResult(res, await getOfficeSignatureRequests(user.sub, user.role, req.params.office));
  };

  public submit = async (req: Request, res: Response) => {
    const user = (req as AuthenticatedRequest).user;
    if (!user) return sendResult(res, { code: 401, message: "Please sign in to continue." });
    return sendResult(res, await submitEnrollmentSession(user.sub, req.body?.session));
  };

  public requestSignature = async (req: Request, res: Response) => {
    const user = (req as AuthenticatedRequest).user;
    if (!user) return sendResult(res, { code: 401, message: "Please sign in to continue." });
    return sendResult(res, await requestOfficeSignature(user.sub, String(req.params.studentId ?? ""), req.body?.office));
  };

  public sign = async (req: Request, res: Response) => {
    const user = (req as AuthenticatedRequest).user;
    if (!user) return sendResult(res, { code: 401, message: "Please sign in to continue." });
    return sendResult(res, await signEnrollmentStep(
      user.sub,
      user.role,
      String(req.params.studentId ?? ""),
      req.body?.office,
      req.body?.feePaid === true,
    ));
  };
}
