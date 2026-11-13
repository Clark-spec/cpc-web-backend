import { Request, Response, NextFunction } from "express";
import { ZodType, ZodError } from "zod";

export class SchemaMiddleware {
  public validate = (schema: ZodType) => {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        await schema.parseAsync({
          body: req.body,
          query: req.query,
          params: req.params,
        });
        return next();
      } catch (error) {
        if (error instanceof ZodError) {
          const fields: Record<string, string> = {};
          for (const issue of error.issues) {
            const path = issue.path.filter((part) => part !== "body").join(".");
            if (path && !fields[path]) fields[path] = issue.message;
          }

          return res.status(400).json({
            success: false,
            code: 400,
            status: "error",
            message: error.issues[0]?.message ?? "Please check the highlighted fields.",
            fields,
            errors: error.issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message,
            })),
          });
        }
        return next(error);
      }
    };
  };
}