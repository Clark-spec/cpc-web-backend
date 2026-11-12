import { Router } from "express";
import { AuthMiddleware } from "@/middlewares/auth-middleware";
import { CsrfMiddleware } from "@/middlewares/csrf-middleware";
import { StudentController } from "@/controllers/student-controller";

const router = Router();
const authMiddleware = new AuthMiddleware();
const csrfMiddleware = new CsrfMiddleware();
const studentController = new StudentController();

// GET /api/students/v1/profile
router.get("/v1/profile", authMiddleware.execute, studentController.getProfile);

// PATCH /api/students/v1/profile
router.patch("/v1/profile", authMiddleware.execute, csrfMiddleware.execute, studentController.updateProfile);

// POST /api/students/v1/profile/avatar
router.post("/v1/profile/avatar", authMiddleware.execute, csrfMiddleware.execute, studentController.updateAvatar);

export default router;
