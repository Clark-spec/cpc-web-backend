import { Router } from "express";
import { AuthMiddleware } from "@/middlewares/auth-middleware";
import { CsrfMiddleware } from "@/middlewares/csrf-middleware";
import { ServiceRequestController } from "@/controllers/service-request-controller";

const router = Router();
const authMiddleware = new AuthMiddleware();
const csrfMiddleware = new CsrfMiddleware();
const serviceRequestController = new ServiceRequestController();

// GET /api/service-requests/v1/catalog — public
router.get("/v1/catalog", serviceRequestController.getCatalog);

// GET /api/service-requests/v1/ — list user's requests
router.get("/v1/", authMiddleware.execute, serviceRequestController.listRequests);

// POST /api/service-requests/v1/ — create request
router.post("/v1/", authMiddleware.execute, csrfMiddleware.execute, serviceRequestController.createRequest);

// Drafts
router.get("/v1/drafts/current", authMiddleware.execute, serviceRequestController.getDraft);
router.put("/v1/drafts", authMiddleware.execute, csrfMiddleware.execute, serviceRequestController.saveDraft);
router.delete("/v1/drafts", authMiddleware.execute, csrfMiddleware.execute, serviceRequestController.deleteDraft);

// Notifications
router.get("/v1/notifications", authMiddleware.execute, serviceRequestController.getNotifications);
router.patch("/v1/notifications/read", authMiddleware.execute, csrfMiddleware.execute, serviceRequestController.markNotificationsRead);

// GET /api/service-requests/v1/:id — single request (must own it)
router.get("/v1/:id", authMiddleware.execute, serviceRequestController.getRequest);

export default router;
