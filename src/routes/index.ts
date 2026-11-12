import { Router } from "express";
import authRoutes from "@/routes/auth-routes";
import recipeRoutes from "@/routes/recipe-routes";
import studentRoutes from "@/routes/student-routes";
import serviceRequestRoutes from "@/routes/service-request-routes";
import scheduleRoutes from "@/routes/schedule-routes";
import sseRoutes from "@/routes/sse-routes";
import notificationRoutes from "@/routes/notification-routes";
import complaintRoutes from "@/routes/complaint-routes";

const router = Router();

// Routes
router.use("/auth", authRoutes);
router.use("/recipes", recipeRoutes);
router.use("/students", studentRoutes);
router.use("/service-requests", serviceRequestRoutes);
router.use("/schedules", scheduleRoutes);
router.use("/notifications", notificationRoutes);
router.use("/complaints", complaintRoutes);
router.use("/sse", sseRoutes);

export default router;
