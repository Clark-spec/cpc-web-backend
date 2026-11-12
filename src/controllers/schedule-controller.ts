import { Request, Response } from "express";
import { getPublishedScheduleService } from "@/services/schedules";
import type { AuthenticatedRequest } from "@/middlewares/auth-middleware";

export class ScheduleController {
  public getPublished = async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).user?.sub ?? "";
    const result = await getPublishedScheduleService(userId);
    return res.status(result.code).json(result);
  };
}
