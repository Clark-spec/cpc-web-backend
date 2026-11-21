import { Router } from "express";
import { AuthMiddleware } from "@/middlewares/auth-middleware";
import { CsrfMiddleware } from "@/middlewares/csrf-middleware";
import { RoleValidatorMiddleware } from "@/middlewares/role-validator-middleware";
import { SchemaMiddleware } from "@/middlewares/schema-middleware";
import { ServiceRequestController } from "@/controllers/service-request-controller";
import {
  createServiceRequestSchema,
  listServiceRequestsSchema,
  saveServiceRequestDraftSchema,
  updateServiceRequestSchema,
} from "@/schema/service-request-schema";

const router = Router();
const authMiddleware = new AuthMiddleware();
const csrfMiddleware = new CsrfMiddleware();
const roleValidator = new RoleValidatorMiddleware();
const schemaMiddleware = new SchemaMiddleware();
const serviceRequestController = new ServiceRequestController();

// Service requests are handled by Registrar; ADMIN retains the full queue.
const serviceRequestAdmins = roleValidator.validate("ADMIN", "REGISTRAR");
const studentOnly = roleValidator.validate("STUDENT");

// GET /api/service-requests/v1/catalog — public
router.get("/v1/catalog", serviceRequestController.getCatalog);

// Admin queue (registered before /v1/:id so "admin" is never read as an id).
router.get(
  "/v1/admin",
  authMiddleware.execute,
  serviceRequestAdmins,
  schemaMiddleware.validate(listServiceRequestsSchema),
  serviceRequestController.listAdmin,
);
router.get(
  "/v1/admin/:id/document",
  authMiddleware.execute,
  serviceRequestAdmins,
  serviceRequestController.getAdminDocument,
);
router.get(
  "/v1/admin/:id",
  authMiddleware.execute,
  serviceRequestAdmins,
  serviceRequestController.getAdmin,
);
router.patch(
  "/v1/admin/:id",
  authMiddleware.execute,
  serviceRequestAdmins,
  csrfMiddleware.execute,
  schemaMiddleware.validate(updateServiceRequestSchema),
  serviceRequestController.updateAdmin,
);

// GET /api/service-requests/v1/ — list user's requests
router.get("/v1/", authMiddleware.execute, studentOnly, serviceRequestController.listRequests);

// POST /api/service-requests/v1/ — create request
router.post(
  "/v1/",
  authMiddleware.execute,
  studentOnly,
  csrfMiddleware.execute,
  schemaMiddleware.validate(createServiceRequestSchema),
  serviceRequestController.createRequest,
);

// Drafts
router.get(
  "/v1/drafts/current",
  authMiddleware.execute,
  studentOnly,
  serviceRequestController.getDraft,
);
router.put(
  "/v1/drafts",
  authMiddleware.execute,
  studentOnly,
  csrfMiddleware.execute,
  schemaMiddleware.validate(saveServiceRequestDraftSchema),
  serviceRequestController.saveDraft,
);
router.delete(
  "/v1/drafts",
  authMiddleware.execute,
  studentOnly,
  csrfMiddleware.execute,
  serviceRequestController.deleteDraft,
);

// Notifications
router.get("/v1/notifications", authMiddleware.execute, serviceRequestController.getNotifications);
router.patch("/v1/notifications/read", authMiddleware.execute, csrfMiddleware.execute, serviceRequestController.markNotificationsRead);

// GET /api/service-requests/v1/:id/document — own attachment
router.get(
  "/v1/:id/document",
  authMiddleware.execute,
  studentOnly,
  serviceRequestController.getDocument,
);

// GET /api/service-requests/v1/:id — single request (must own it)
router.get("/v1/:id", authMiddleware.execute, studentOnly, serviceRequestController.getRequest);

export default router;
