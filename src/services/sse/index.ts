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

