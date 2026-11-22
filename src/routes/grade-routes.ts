import { Router } from "express";
import { AuthMiddleware } from "@/middlewares/auth-middleware";
import { CsrfMiddleware } from "@/middlewares/csrf-middleware";
import { RoleValidatorMiddleware } from "@/middlewares/role-validator-middleware";
import { GradeController } from "@/controllers/grade-controller";

const router = Router();
const auth = new AuthMiddleware();
const csrf = new CsrfMiddleware();
const roles = new RoleValidatorMiddleware();
const controller = new GradeController();

router.get("/v1/registrar/students", auth.execute, roles.validate("ADMIN", "REGISTRAR"), controller.listStudents);
router.get("/v1/records", auth.execute, roles.validate("STUDENT"), controller.studentRecords);
router.post("/v1/registrar/save", auth.execute, roles.validate("ADMIN", "REGISTRAR"), csrf.execute, controller.save);
router.post("/v1/acknowledge", auth.execute, roles.validate("STUDENT"), csrf.execute, controller.acknowledge);

export default router;
