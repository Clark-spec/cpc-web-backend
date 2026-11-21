import { Router } from "express";
import authRoutes from "@/routes/auth-routes";
import recipeRoutes from "@/routes/recipe-routes";
import studentRoutes from "@/routes/student-routes";
import serviceRequestRoutes from "@/routes/service-request-routes";
import scheduleRoutes from "@/routes/schedule-routes";
import sseRoutes from "@/routes/sse-routes";
import notificationRoutes from "@/routes/notification-routes";
import complaintRoutes from "@/routes/complaint-routes";
import academicCalendarRoutes from "@/routes/academic-calendar-routes";
import enrollmentRoutes from "@/routes/enrollment-routes";

const router = Router();

// Routes
router.use("/auth", authRoutes);
router.use("/recipes", recipeRoutes);
router.use("/students", studentRoutes);
router.use("/service-requests", serviceRequestRoutes);
router.use("/schedules", scheduleRoutes);
router.use("/notifications", notificationRoutes);
router.use("/complaints", complaintRoutes);
router.use("/academic-calendar", academicCalendarRoutes);
router.use("/enrollment", enrollmentRoutes);
router.use("/sse", sseRoutes);

export default router;
