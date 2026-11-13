import type { NextFunction, Request, Response } from "express";
import type { AuthenticatedRequest } from "@/middlewares/auth-middleware";

export type Role =
  | "USER"
  | "STUDENT"
  | "ADMIN"
  | "REGISTRAR"
  | "DEAN"
  | "LIBRARY"
  | "ACCOUNTING"
  | "SAO"
  | "INSTRUCTOR";

export class RoleValidatorMiddleware {
  public validate = (...allowedRoles: Role[]) => {
    return (req: Request, res: Response, next: NextFunction) => {
      const { user } = req as AuthenticatedRequest;

      if (!user || user.type !== "access") {
        return res.status(401).json({
          success: false,
          code: 401,
          status: "error",
          message: "Please sign in to continue.",
        });
      }
  
      if (!allowedRoles.some((role) => role === user.role)) {
        return res.status(403).json({
          success: false,
          code: 403,
          status: "error",
          message: "You do not have access to this section.",
        });
      }

      return next();
    };
  };
}
