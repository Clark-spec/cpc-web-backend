import { Request, Response } from "express";
import { getProfileService, updateProfileService, updateAvatarService } from "@/services/students";
import type { AuthenticatedRequest } from "@/middlewares/auth-middleware";

export class StudentController {
  public getProfile = async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).user?.sub ?? "";
    const result = await getProfileService(userId);
    return res.status(result.code).json(result);
  };

  public updateProfile = async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).user?.sub ?? "";
    const result = await updateProfileService(userId, req.body ?? {});
    return res.status(result.code).json(result);
  };

  public updateAvatar = async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).user?.sub ?? "";
    const { avatarUrl } = req.body ?? {};
    const result = await updateAvatarService(userId, avatarUrl);
    return res.status(result.code).json(result);
  };
}
