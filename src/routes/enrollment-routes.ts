import { Router } from "express";
import { AuthMiddleware } from "@/middlewares/auth-middleware";
import { CsrfMiddleware } from "@/middlewares/csrf-middleware";
import { RoleValidatorMiddleware } from "@/middlewares/role-validator-middleware";
import { EnrollmentController } from "@/controllers/enrollment-controller";

const router = Router();
const auth = new AuthMiddleware();
const csrf = new CsrfMiddleware();
const roles = new RoleValidatorMiddleware();
const controller = new EnrollmentController();

router.get("/v1/sessions/mine", auth.execute, roles.validate("STUDENT"), controller.mine);
router.get("/v1/sessions/requests/:office", auth.execute, roles.validate("ADMIN", "DEAN", "GUIDANCE", "CLINIC", "ACCOUNTING", "REGISTRAR"), controller.officeRequests);
router.post("/v1/sessions/submit", auth.execute, roles.validate("STUDENT"), csrf.execute, controller.submit);
router.post("/v1/sessions/:studentId/request", auth.execute, roles.validate("STUDENT"), csrf.execute, controller.requestSignature);
router.post("/v1/sessions/:studentId/sign", auth.execute, roles.validate("ADMIN", "DEAN", "GUIDANCE", "CLINIC", "ACCOUNTING", "REGISTRAR"), csrf.execute, controller.sign);

export default router;
