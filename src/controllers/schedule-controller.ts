import { Request, Response } from "express";
import { getPublishedScheduleService, publishScheduleService } from "@/services/schedules";
import type { AuthenticatedRequest } from "@/middlewares/auth-middleware";

export class ScheduleController {
  public getPublished = async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).user?.sub ?? "";
    const result = await getPublishedScheduleService(userId);
    return res.status(result.code).json(result);
  };

  public publish = async (req: Request, res: Response) => {
    const result = await publishScheduleService(req.body);
    return res.status(result.code).json(result);
  };
}
