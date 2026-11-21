import { Router } from "express";
import { AuthMiddleware } from "@/middlewares/auth-middleware";
import { CsrfMiddleware } from "@/middlewares/csrf-middleware";
import { StudentController } from "@/controllers/student-controller";
import { StudentAccountController } from "@/controllers/student-account-controller";
import { RoleValidatorMiddleware } from "@/middlewares/role-validator-middleware";
import { SchemaMiddleware } from "@/middlewares/schema-middleware";
import { changePasswordSchema, createStudentAccountSchema } from "@/schema/student-account-schema";

const router = Router();
const authMiddleware = new AuthMiddleware();
const csrfMiddleware = new CsrfMiddleware();
const studentController = new StudentController();
const accountController = new StudentAccountController();
const roleValidator = new RoleValidatorMiddleware();
const schemaMiddleware = new SchemaMiddleware();

router.get("/v1/accounts", authMiddleware.execute, roleValidator.validate("ADMIN", "REGISTRAR"), accountController.list);
router.post("/v1/accounts", authMiddleware.execute, roleValidator.validate("ADMIN", "REGISTRAR"), csrfMiddleware.execute, schemaMiddleware.validate(createStudentAccountSchema), accountController.create);
router.delete("/v1/accounts/:id", authMiddleware.execute, roleValidator.validate("ADMIN", "REGISTRAR"), csrfMiddleware.execute, accountController.delete);
router.patch("/v1/password", authMiddleware.execute, csrfMiddleware.execute, schemaMiddleware.validate(changePasswordSchema), accountController.changePassword);
router.get("/v1/continuing-record", authMiddleware.execute, roleValidator.validate("STUDENT"), accountController.continuingRecord);

// GET /api/students/v1/profile
router.get("/v1/profile", authMiddleware.execute, studentController.getProfile);

// PATCH /api/students/v1/profile
router.patch("/v1/profile", authMiddleware.execute, csrfMiddleware.execute, studentController.updateProfile);

// POST /api/students/v1/profile/avatar
router.post("/v1/profile/avatar", authMiddleware.execute, csrfMiddleware.execute, studentController.updateAvatar);

export default router;
