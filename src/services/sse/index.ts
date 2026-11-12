import { EventEmitter } from "events";

// In-memory event emitter for SSE broadcasts
export const sseEmitter = new EventEmitter();
sseEmitter.setMaxListeners(500);

export type SSEEvent = {
  event: string;
  data: unknown;
};

export function broadcastToUser(userId: string, event: SSEEvent) {
  sseEmitter.emit(`user:${userId}`, event);
}

export function broadcastProfileUpdated(userId: string) {
  broadcastToUser(userId, { event: "profile_updated", data: {} });
}

export function broadcastNotificationUpdated(userId: string) {
  broadcastToUser(userId, { event: "notification_updated", data: {} });
}

/** Delivers a new bell item straight away, so the badge needs no refetch. */
export function broadcastNotificationCreated(
  userId: string,
  data: {
    id: string;
    title: string | null;
    message: string;
    type: string;
    href: string | null;
    createdAt: string;
  },
) {
  broadcastToUser(userId, { event: "notification_created", data });
}

export function broadcastComplaintUpdated(
  userId: string,
  data: { complaintId: string; status: string; updatedAt: string; adminRemarks: string },
) {
  broadcastToUser(userId, { event: "complaint_updated", data });
}

