import { Router } from "express";
import { AuthMiddleware } from "@/middlewares/auth-middleware";
import { ScheduleController } from "@/controllers/schedule-controller";

const router = Router();
const authMiddleware = new AuthMiddleware();
const scheduleController = new ScheduleController();

// GET /api/schedules/v1/published
router.get("/v1/published", authMiddleware.execute, scheduleController.getPublished);

// POST /api/schedules/v1/publish
router.post("/v1/publish", authMiddleware.execute, scheduleController.publish);

export default router;
