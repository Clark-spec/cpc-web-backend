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
router.post("/v1/sessions/verify", auth.execute, roles.validate("STUDENT"), csrf.execute, controller.verify);
router.put("/v1/sessions/draft", auth.execute, roles.validate("STUDENT"), csrf.execute, controller.saveDraft);
router.get("/v1/sessions/requests/:office", auth.execute, roles.validate("ADMIN", "DEAN", "GUIDANCE", "CLINIC", "ACCOUNTING", "REGISTRAR"), controller.officeRequests);
router.post("/v1/sessions/submit", auth.execute, roles.validate("STUDENT"), csrf.execute, controller.submit);
router.post("/v1/sessions/:studentId/request", auth.execute, roles.validate("STUDENT"), csrf.execute, controller.requestSignature);
router.post("/v1/sessions/:studentId/cancel-request", auth.execute, roles.validate("STUDENT"), csrf.execute, controller.cancelSignatureRequest);
router.post("/v1/sessions/:studentId/sign", auth.execute, roles.validate("ADMIN", "DEAN", "GUIDANCE", "CLINIC", "ACCOUNTING", "REGISTRAR"), csrf.execute, controller.sign);
router.get("/v1/signatures", auth.execute, roles.validate("ADMIN", "DEAN", "GUIDANCE", "CLINIC", "ACCOUNTING", "REGISTRAR", "LIBRARY", "SAO"), controller.savedSignatures);
router.post("/v1/signatures", auth.execute, roles.validate("ADMIN", "DEAN", "GUIDANCE", "CLINIC", "ACCOUNTING", "REGISTRAR", "LIBRARY", "SAO"), csrf.execute, controller.createSavedSignature);
router.patch("/v1/signatures/:signatureId", auth.execute, roles.validate("ADMIN", "DEAN", "GUIDANCE", "CLINIC", "ACCOUNTING", "REGISTRAR", "LIBRARY", "SAO"), csrf.execute, controller.updateSavedSignature);
router.delete("/v1/signatures/:signatureId", auth.execute, roles.validate("ADMIN", "DEAN", "GUIDANCE", "CLINIC", "ACCOUNTING", "REGISTRAR", "LIBRARY", "SAO"), csrf.execute, controller.deleteSavedSignature);
router.get("/v1/clearance/mine", auth.execute, roles.validate("STUDENT"), controller.clearanceMine);
router.get("/v1/clearance/records", auth.execute, roles.validate("ADMIN", "REGISTRAR", "DEAN", "SAO", "LIBRARY", "ACCOUNTING"), controller.clearanceList);
router.post("/v1/clearance/mine/action", auth.execute, roles.validate("STUDENT"), csrf.execute, controller.clearanceUpdate);
router.post("/v1/clearance/records/:studentId/action", auth.execute, roles.validate("ADMIN", "REGISTRAR", "DEAN", "SAO", "LIBRARY", "ACCOUNTING"), csrf.execute, controller.clearanceUpdate);

export default router;
