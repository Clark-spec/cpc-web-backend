import { Request, Response } from "express";
import type { AuthenticatedRequest } from "@/middlewares/auth-middleware";
import { sendResult } from "@/lib/api-response";
import {
  changeStudentPasswordService,
  createStudentAccountService,
  deleteStudentAccountService,
  listStudentAccountsService,
  getStudentContinuingRecordService,
} from "@/services/students/accounts";

export class StudentAccountController {
  public list = async (_req: Request, res: Response) =>
    sendResult(res, await listStudentAccountsService());

  public create = async (req: Request, res: Response) => {
    const { name, section, gender, dateOfBirth } = req.body ?? {};
    return sendResult(res, await createStudentAccountService(name, section, gender, dateOfBirth));
  };

  public delete = async (req: Request, res: Response) =>
    sendResult(res, await deleteStudentAccountService(String(req.params.id ?? "")));

  public continuingRecord = async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).user?.sub ?? "";
    return sendResult(res, await getStudentContinuingRecordService(userId));
  };

  public changePassword = async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).user?.sub ?? "";
    const { currentPassword, newPassword } = req.body ?? {};
    return sendResult(res, await changeStudentPasswordService(userId, currentPassword, newPassword));
  };
}
