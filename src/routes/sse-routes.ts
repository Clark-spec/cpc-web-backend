import { Router } from "express";
import { AuthMiddleware } from "@/middlewares/auth-middleware";
import { SseController } from "@/controllers/sse-controller";

const router = Router();
const authMiddleware = new AuthMiddleware();
const sseController = new SseController();

// GET /api/sse/v1/student
router.get("/v1/student", authMiddleware.execute, sseController.studentStream);

export default router;
