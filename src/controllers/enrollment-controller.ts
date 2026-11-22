import { Request, Response } from "express";
import type { AuthenticatedRequest } from "@/middlewares/auth-middleware";
import { sendResult } from "@/lib/api-response";
import {
  getOfficeSignatureRequests,
  cancelOfficeSignatureRequest,
  confirmEnrollmentVerification,
  getOwnEnrollmentSession,
  requestOfficeSignature,
  signEnrollmentStep,
  submitEnrollmentSession,
  saveEnrollmentDraft,
  getClearanceRecord, listClearanceRecords, requestClearanceSignatures, updateClearance,
  finishSignatureQueueProcessing, getPublicSignatureBoards, startSignatureQueueProcessing,
} from "@/services/enrollment";
import {
  createStaffSignature,
  deleteStaffSignature,
  listStaffSignatures,
  updateStaffSignature,
} from "@/services/staff-signatures";

export class EnrollmentController {
  public signatureBoards = async (_req: Request, res: Response) => sendResult(res, await getPublicSignatureBoards());
  public startSignatureProcessing = async (req: Request, res: Response) => {
    const user = (req as AuthenticatedRequest).user;
    if (!user) return sendResult(res, { code: 401, message: "Please sign in." });
    return sendResult(res, await startSignatureQueueProcessing(user.sub, user.role, req.body?.queueType, req.body?.office, String(req.body?.studentId ?? ""), req.body?.feePaidConfirmed === true));
  };
  public finishSignatureProcessing = async (req: Request, res: Response) => {
    const user = (req as AuthenticatedRequest).user;
    if (!user) return sendResult(res, { code: 401, message: "Please sign in." });
    return sendResult(res, await finishSignatureQueueProcessing(user.sub, user.role, req.body?.queueType, req.body?.office, String(req.body?.studentId ?? "")));
  };
  public savedSignatures = async (req: Request, res: Response) => {
    const user = (req as AuthenticatedRequest).user;
    if (!user) return sendResult(res, { code: 401, message: "Please sign in." });
    return sendResult(res, await listStaffSignatures(user.sub));
  };
  public createSavedSignature = async (req: Request, res: Response) => {
    const user = (req as AuthenticatedRequest).user;
    if (!user) return sendResult(res, { code: 401, message: "Please sign in." });
    return sendResult(res, await createStaffSignature(user.sub, req.body ?? {}));
  };
  public updateSavedSignature = async (req: Request, res: Response) => {
    const user = (req as AuthenticatedRequest).user;
    if (!user) return sendResult(res, { code: 401, message: "Please sign in." });
    return sendResult(res, await updateStaffSignature(user.sub, String(req.params.signatureId ?? ""), req.body ?? {}));
  };
  public deleteSavedSignature = async (req: Request, res: Response) => {
    const user = (req as AuthenticatedRequest).user;
    if (!user) return sendResult(res, { code: 401, message: "Please sign in." });
    return sendResult(res, await deleteStaffSignature(user.sub, String(req.params.signatureId ?? "")));
  };
  public clearanceMine = async (req: Request, res: Response) => { const u = (req as AuthenticatedRequest).user; if (!u) return sendResult(res, { code: 401, message: "Please sign in." }); return sendResult(res, await getClearanceRecord(u.sub, u.role)); };
  public clearanceList = async (req: Request, res: Response) => { const u = (req as AuthenticatedRequest).user; if (!u) return sendResult(res, { code: 401, message: "Please sign in." }); return sendResult(res, await listClearanceRecords(u.sub, u.role)); };
  public clearanceRequestMany = async (req: Request, res: Response) => { const u = (req as AuthenticatedRequest).user; if (!u) return sendResult(res, { code: 401, message: "Please sign in." }); return sendResult(res, await requestClearanceSignatures(u.sub, req.body?.offices, req.body?.note)); };
  public clearanceUpdate = async (req: Request, res: Response) => { const u = (req as AuthenticatedRequest).user; if (!u) return sendResult(res, { code: 401, message: "Please sign in." }); return sendResult(res, await updateClearance(u.sub, u.role, req.params.studentId ?? null, req.body ?? {})); };
  public mine = async (req: Request, res: Response) => {
    const user = (req as AuthenticatedRequest).user;
    if (!user) return sendResult(res, { code: 401, message: "Please sign in to continue." });
    return sendResult(res, await getOwnEnrollmentSession(user.sub));
  };

  public verify = async (req: Request, res: Response) => {
    const user = (req as AuthenticatedRequest).user;
    if (!user) return sendResult(res, { code: 401, message: "Please sign in to continue." });
    return sendResult(res, await confirmEnrollmentVerification(user.sub));
  };

  public saveDraft = async (req: Request, res: Response) => {
    const user = (req as AuthenticatedRequest).user;
    if (!user) return sendResult(res, { code: 401, message: "Please sign in to continue." });
    return sendResult(res, await saveEnrollmentDraft(user.sub, req.body));
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

  public cancelSignatureRequest = async (req: Request, res: Response) => {
    const user = (req as AuthenticatedRequest).user;
    if (!user) return sendResult(res, { code: 401, message: "Please sign in to continue." });
    return sendResult(res, await cancelOfficeSignatureRequest(user.sub, String(req.params.studentId ?? ""), req.body?.office));
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
      req.body?.signature,
    ));
  };
}
