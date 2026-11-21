import { Router } from "express";
import { AuthMiddleware } from "@/middlewares/auth-middleware";
import { CsrfMiddleware } from "@/middlewares/csrf-middleware";
import { RoleValidatorMiddleware } from "@/middlewares/role-validator-middleware";
import { SchemaMiddleware } from "@/middlewares/schema-middleware";
import { SubmitRateLimiter } from "@/middlewares/rate-limit-middleware";
import { ComplaintController } from "@/controllers/complaint-controller";
import {
  createComplaintSchema,
  listComplaintsSchema,
  updateComplaintSchema,
} from "@/schema/complaint-schema";

const router = Router();
const authMiddleware = new AuthMiddleware();
const csrfMiddleware = new CsrfMiddleware();
const roleValidator = new RoleValidatorMiddleware();
const schemaMiddleware = new SchemaMiddleware();
const submitRateLimiter = new SubmitRateLimiter();
const complaintController = new ComplaintController();

// Staff roles that own Student Support > Complaints.
const complaintAdmins = roleValidator.validate("ADMIN", "REGISTRAR", "DEAN", "SAO", "ACCOUNTING", "CLINIC");
const studentOnly = roleValidator.validate("STUDENT");

// Student: own complaint list + cooldown state.
router.get(
  "/v1/me",
  authMiddleware.execute,
  studentOnly,
  complaintController.listMine,
);

// Student: submit a complaint (72-hour rolling limit enforced in the repo).
router.post(
  "/v1/",
  authMiddleware.execute,
  studentOnly,
  submitRateLimiter.execute,
  csrfMiddleware.execute,
  schemaMiddleware.validate(createComplaintSchema),
  complaintController.create,
);

// Admin queue.
router.get(
  "/v1/admin",
  authMiddleware.execute,
  complaintAdmins,
  schemaMiddleware.validate(listComplaintsSchema),
  complaintController.listForAdmin,
);

router.get(
  "/v1/admin/:id",
  authMiddleware.execute,
  complaintAdmins,
  complaintController.getForAdmin,
);

router.patch(
  "/v1/admin/:id",
  authMiddleware.execute,
  complaintAdmins,
  csrfMiddleware.execute,
  schemaMiddleware.validate(updateComplaintSchema),
  complaintController.update,
);

export default router;
