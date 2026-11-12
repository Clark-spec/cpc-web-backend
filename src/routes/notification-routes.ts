import { Router } from "express";
import { AuthMiddleware } from "@/middlewares/auth-middleware";
import { CsrfMiddleware } from "@/middlewares/csrf-middleware";
import { NotificationController } from "@/controllers/notification-controller";

const router = Router();
const authMiddleware = new AuthMiddleware();
const csrfMiddleware = new CsrfMiddleware();
const controller = new NotificationController();

// GET /api/notifications/v1
router.get("/v1", authMiddleware.execute, controller.getNotifications);

// PATCH /api/notifications/v1/read-all
router.patch("/v1/read-all", authMiddleware.execute, csrfMiddleware.execute, controller.markAllRead);

// PATCH /api/notifications/v1/:id/read
router.patch("/v1/:id/read", authMiddleware.execute, csrfMiddleware.execute, controller.markNotificationRead);

// DELETE /api/notifications/v1
router.delete("/v1", authMiddleware.execute, csrfMiddleware.execute, controller.deleteAllNotifications);

// DELETE /api/notifications/v1/:id
router.delete("/v1/:id", authMiddleware.execute, csrfMiddleware.execute, controller.deleteNotification);

export default router;

