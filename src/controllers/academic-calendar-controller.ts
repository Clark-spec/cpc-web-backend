import { Request, Response } from "express";
import {
  createAcademicEventService,
  deleteAcademicEventService,
  getAcademicEventService,
  listAcademicEventsService,
  updateAcademicEventService,
} from "@/services/academic-calendar";
import type { AuthenticatedRequest } from "@/middlewares/auth-middleware";

type ServiceResult = {
  code: number;
  status: string;
  message?: string;
  data?: unknown;
  fields?: Record<string, string>;
};

/** Shared envelope; adds the optional per-field validation map. */
function respond(res: Response, result: ServiceResult) {
  const success = result.code < 400;
  return res.status(result.code).json({
    success,
    code: result.code,
    status: success ? "success" : "error",
    ...(result.message ? { message: result.message } : {}),
    ...(result.data !== undefined ? { data: result.data } : {}),
    ...(result.fields ? { fields: result.fields } : {}),
  });
}

function eventId(req: Request): string {
  return Array.isArray(req.params.id) ? (req.params.id[0] ?? "") : (req.params.id ?? "");
}

function role(req: Request) {
  return (req as AuthenticatedRequest).user?.role;
}

export class AcademicCalendarController {
  public list = async (req: Request, res: Response) => {
    const result = await listAcademicEventsService(req, role(req));
    return respond(res, result as ServiceResult);
  };

  public get = async (req: Request, res: Response) => {
    const result = await getAcademicEventService(eventId(req), role(req));
    return respond(res, result as ServiceResult);
  };

  public create = async (req: Request, res: Response) => {
    const result = await createAcademicEventService(req);
    return respond(res, result as ServiceResult);
  };

  public update = async (req: Request, res: Response) => {
    const result = await updateAcademicEventService(req, eventId(req));
    return respond(res, result as ServiceResult);
  };

  public remove = async (req: Request, res: Response) => {
    const result = await deleteAcademicEventService(eventId(req));
    return respond(res, result as ServiceResult);
  };
}
