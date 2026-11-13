import { Request, Response } from "express";
import { NotificationRepository } from "@/repositories/notification-repository";
import { broadcastNotificationUpdated } from "@/services/sse";
import type { AuthenticatedRequest } from "@/middlewares/auth-middleware";
import { sendResult } from "@/lib/api-response";

const repo = new NotificationRepository();

export class NotificationController {
  public getNotifications = async (req: Request, res: Response) => {
    try {
      const userId = (req as AuthenticatedRequest).user?.sub ?? "";
      if (!userId) {
        return sendResult(res, { code: 401, message: "Please sign in to continue." });
      }

      const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
      const offset = Math.max(0, Number(req.query.offset) || 0);
      const data = await repo.findPageByUserId(userId, { limit, offset });
      return sendResult(res, { code: 200, data });
    } catch (error) {
      console.error("getNotifications Error:", error);
      return sendResult(res, {
        code: 500,
        message: "Notifications are unavailable right now. Please try again.",
      });
    }
  };

  public markNotificationRead = async (req: Request, res: Response) => {
    try {
      const userId = (req as AuthenticatedRequest).user?.sub ?? "";
      const notifId = String(req.params.id ?? "");
      if (!userId || !notifId) {
        return sendResult(res, { code: 400, message: "We could not complete that request." });
      }

      await repo.markAsRead(userId, notifId);
      broadcastNotificationUpdated(userId);

      return sendResult(res, { code: 200, message: "Notification marked as read" });
    } catch (error) {
      console.error("markNotificationRead Error:", error);
      return sendResult(res, {
        code: 500,
        message: "We could not update that notification. Please try again.",
      });
    }
  };

  public markAllRead = async (req: Request, res: Response) => {
    try {
      const userId = (req as AuthenticatedRequest).user?.sub ?? "";
      if (!userId) {
        return sendResult(res, { code: 401, message: "Please sign in to continue." });
      }

      await repo.markAllAsRead(userId);
      broadcastNotificationUpdated(userId);

      return sendResult(res, { code: 200, message: "All notifications marked as read" });
    } catch (error) {
      console.error("markAllRead Error:", error);
      return sendResult(res, {
        code: 500,
        message: "We could not update your notifications. Please try again.",
      });
    }
  };

  public deleteNotification = async (req: Request, res: Response) => {
    try {
      const userId = (req as AuthenticatedRequest).user?.sub ?? "";
      const notifId = String(req.params.id ?? "");
      if (!userId || !notifId) {
        return sendResult(res, { code: 400, message: "We could not complete that request." });
      }

      await repo.delete(userId, notifId);
      broadcastNotificationUpdated(userId);

      return sendResult(res, { code: 200, message: "Notification deleted" });
    } catch (error) {
      console.error("deleteNotification Error:", error);
      return sendResult(res, {
        code: 500,
        message: "We could not delete that notification. Please try again.",
      });
    }
  };

  public deleteAllNotifications = async (req: Request, res: Response) => {
    try {
      const userId = (req as AuthenticatedRequest).user?.sub ?? "";
      if (!userId) {
        return sendResult(res, { code: 401, message: "Please sign in to continue." });
      }

      await repo.deleteAll(userId);
      broadcastNotificationUpdated(userId);

      return sendResult(res, { code: 200, message: "All notifications cleared" });
    } catch (error) {
      console.error("deleteAllNotifications Error:", error);
      return sendResult(res, {
        code: 500,
        message: "We could not clear your notifications. Please try again.",
      });
    }
  };
}
