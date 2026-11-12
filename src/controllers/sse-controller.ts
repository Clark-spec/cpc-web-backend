import { Request, Response } from "express";
import { sseEmitter } from "@/services/sse";
import type { AuthenticatedRequest } from "@/middlewares/auth-middleware";

const HEARTBEAT_INTERVAL_MS = 25_000;

export class SseController {
  public studentStream = (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).user?.sub ?? "";

    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // Initial connection event
    send("connected", { userId });

    // Heartbeat
    const heartbeat = setInterval(() => {
      send("ping", {});
    }, HEARTBEAT_INTERVAL_MS);

    // Per-user event listener
    const listener = (payload: { event: string; data: unknown }) => {
      send(payload.event, payload.data);
    };
    sseEmitter.on(`user:${userId}`, listener);

    // Cleanup on disconnect
    req.on("close", () => {
      clearInterval(heartbeat);
      sseEmitter.off(`user:${userId}`, listener);
    });
  };
}
