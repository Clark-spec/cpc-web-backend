import { Router } from "express";
import { AuthMiddleware } from "@/middlewares/auth-middleware";
import { CsrfMiddleware } from "@/middlewares/csrf-middleware";
import { RoleValidatorMiddleware } from "@/middlewares/role-validator-middleware";
import { SchemaMiddleware } from "@/middlewares/schema-middleware";
import { AcademicCalendarController } from "@/controllers/academic-calendar-controller";
import {
  createAcademicEventSchema,
  listAcademicEventsSchema,
  updateAcademicEventSchema,
} from "@/schema/academic-calendar-schema";

const router = Router();
const authMiddleware = new AuthMiddleware();
const csrfMiddleware = new CsrfMiddleware();
const roleValidator = new RoleValidatorMiddleware();
const schemaMiddleware = new SchemaMiddleware();
const academicCalendarController = new AcademicCalendarController();

// Academics > Academic Calendar is shared by the administrator, registrar and
// the three program deans; students keep read-only access.
const calendarAdmins = roleValidator.validate("ADMIN", "REGISTRAR", "DEAN");

// Every signed-in account can read; students only ever receive published rows.
router.get(
  "/v1/events",
  authMiddleware.execute,
  schemaMiddleware.validate(listAcademicEventsSchema),
  academicCalendarController.list,
);

router.get("/v1/events/:id", authMiddleware.execute, academicCalendarController.get);

router.post(
  "/v1/events",
  authMiddleware.execute,
  calendarAdmins,
  csrfMiddleware.execute,
  schemaMiddleware.validate(createAcademicEventSchema),
  academicCalendarController.create,
);

router.put(
  "/v1/events/:id",
  authMiddleware.execute,
  calendarAdmins,
  csrfMiddleware.execute,
  schemaMiddleware.validate(updateAcademicEventSchema),
  academicCalendarController.update,
);

router.patch(
  "/v1/events/:id",
  authMiddleware.execute,
  calendarAdmins,
  csrfMiddleware.execute,
  schemaMiddleware.validate(updateAcademicEventSchema),
  academicCalendarController.update,
);

router.delete(
  "/v1/events/:id",
  authMiddleware.execute,
  calendarAdmins,
  csrfMiddleware.execute,
  academicCalendarController.remove,
);

export default router;
