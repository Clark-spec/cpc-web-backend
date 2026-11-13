import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import hpp from "hpp";
import { ENV } from "@/config/env";
import routes from "@/routes";

const app = express();

// --- Core Middleware ---
app.use(helmet());
app.use(cors({
  origin: ENV.FRONTEND_URL,
  credentials: true
}));

// Complaint attachments arrive as base64 data URLs (<= 5 MB file).
app.use(express.json({ limit: "8mb" }));
app.use(express.urlencoded({ extended: true, limit: "8mb" }));
app.use(cookieParser());
app.use(hpp());

// --- Simple Health Check ---
app.get("/", (req: Request, res: Response) => {
  res.status(200).json({
    status: "success",
    message: `${ENV.APP_NAME} instance is healthy - 3B - New Features!`,
    timestamp: new Date().toISOString(),
    environment: ENV.NODE_ENV
  });
});

// --- API Health Check ---
app.get("/api/health", (_req: Request, res: Response) => {
  res.status(200).json({
    status: "success",
    message: "API is healthy",
    timestamp: new Date().toISOString()
  });
});

// --- API Routes ---
app.use("/api", routes);

// --- 404 Handler ---
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    code: 404,
    status: "error",
    message: "The requested resource could not be found."
  });
});

// --- Global Error Handler ---
// Never leak stack traces, SQL, or internal details to the client. The full
// error is logged server-side only (request bodies, passwords and tokens are
// never attached to `err` by the handlers above).
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error("🔥 Global Error Hook:", err);

  if (err?.type === "entity.too.large" || err?.status === 413) {
    return res.status(413).json({
      success: false,
      code: 413,
      status: "error",
      message: "That file or request is too large. Please use a smaller file."
    });
  }

  if (err?.type === "entity.parse.failed" || err?.status === 400) {
    return res.status(400).json({
      success: false,
      code: 400,
      status: "error",
      message: "We could not read that request. Please refresh and try again."
    });
  }

  const statusCode = Number(err?.status) >= 400 && Number(err?.status) < 500 ? Number(err.status) : 500;
  res.status(statusCode).json({
    success: false,
    code: statusCode,
    status: "error",
    message:
      statusCode < 500
        ? "The request could not be completed."
        : "The service is temporarily unavailable. Please try again."
  });
});

export default app;