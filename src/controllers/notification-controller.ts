import { Request, Response } from "express";
import { NotificationRepository } from "@/repositories/notification-repository";
import { broadcastNotificationUpdated } from "@/services/sse";
import type { AuthenticatedRequest } from "@/middlewares/auth-middleware";

const repo = new NotificationRepository();

export class NotificationController {
  public getNotifications = async (req: Request, res: Response) => {
    try {
      const userId = (req as AuthenticatedRequest).user?.sub ?? "";
      if (!userId) {
        return res.status(401).json({ status: "error", message: "Unauthorized" });
      }

      const data = await repo.findByUserId(userId);
      return res.status(200).json({
        status: "success",
        data,
      });
    } catch (error) {
      console.error("getNotifications Error:", error);
      return res.status(500).json({ status: "error", message: "Failed to fetch notifications" });
    }
  };

  public markNotificationRead = async (req: Request, res: Response) => {
    try {
      const userId = (req as AuthenticatedRequest).user?.sub ?? "";
      const notifId = req.params.id;
      if (!userId || !notifId) {
        return res.status(400).json({ status: "error", message: "Invalid request" });
      }

      await repo.markAsRead(userId, notifId);
      broadcastNotificationUpdated(userId);

      return res.status(200).json({
        status: "success",
        message: "Notification marked as read",
      });
    } catch (error) {
      console.error("markNotificationRead Error:", error);
      return res.status(500).json({ status: "error", message: "Failed to update notification" });
    }
  };

  public markAllRead = async (req: Request, res: Response) => {
    try {
      const userId = (req as AuthenticatedRequest).user?.sub ?? "";
      if (!userId) {
        return res.status(401).json({ status: "error", message: "Unauthorized" });
      }

      await repo.markAllAsRead(userId);
      broadcastNotificationUpdated(userId);

      return res.status(200).json({
        status: "success",
        message: "All notifications marked as read",
      });
    } catch (error) {
      console.error("markAllRead Error:", error);
      return res.status(500).json({ status: "error", message: "Failed to update notifications" });
    }
  };

  public deleteNotification = async (req: Request, res: Response) => {
    try {
      const userId = (req as AuthenticatedRequest).user?.sub ?? "";
      const notifId = req.params.id;
      if (!userId || !notifId) {
        return res.status(400).json({ status: "error", message: "Invalid request" });
      }

      await repo.delete(userId, notifId);
      broadcastNotificationUpdated(userId);

      return res.status(200).json({
        status: "success",
        message: "Notification deleted successfully",
      });
    } catch (error) {
      console.error("deleteNotification Error:", error);
      return res.status(500).json({ status: "error", message: "Failed to delete notification" });
    }
  };

  public deleteAllNotifications = async (req: Request, res: Response) => {
    try {
      const userId = (req as AuthenticatedRequest).user?.sub ?? "";
      if (!userId) {
        return res.status(401).json({ status: "error", message: "Unauthorized" });
      }

      await repo.deleteAll(userId);
      broadcastNotificationUpdated(userId);

      return res.status(200).json({
        status: "success",
        message: "All notifications deleted successfully",
      });
    } catch (error) {
      console.error("deleteAllNotifications Error:", error);
      return res.status(500).json({ status: "error", message: "Failed to clear notifications" });
    }
  };
}

