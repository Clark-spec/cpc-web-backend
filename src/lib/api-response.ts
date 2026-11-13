import type { Response } from "express";

export type ApiEnvelope<T = unknown> = {
  success: boolean;
  code: number;
  status: "success" | "error";
  message?: string;
  data?: T;
  retryAfter?: number;
};

type ResultLike<T = unknown> = {
  code: number;
  status?: string;
  message?: string;
  data?: T;
  retryAfter?: number;
};

/**
 * Sends a service result using the shared student-facing envelope.
 *
 * Legacy fields (code/status/message/data) are kept so existing callers keep
 * working; `success` and `retryAfter` are additive. When a result carries a
 * `retryAfter` (seconds) the matching Retry-After header is set as well.
 */
export function sendResult(res: Response, result: ResultLike<unknown>) {
  const code = Number.isFinite(result.code) ? result.code : 500;
  const success = code < 400;

  const body: ApiEnvelope<unknown> = {
    success,
    code,
    status:
      result.status === "success" || result.status === "error"
        ? result.status
        : success
          ? "success"
          : "error",
    ...(result.message ? { message: result.message } : {}),
    ...(result.data !== undefined ? { data: result.data } : {}),
    ...(result.retryAfter ? { retryAfter: result.retryAfter } : {}),
  };

  if (result.retryAfter) {
    res.setHeader("Retry-After", String(result.retryAfter));
  }

  return res.status(code).json(body);
}

/** Convenience for handlers that build an error inline. */
export function sendError(
  res: Response,
  code: number,
  message: string,
  extra: Partial<ApiEnvelope> = {},
) {
  return sendResult(res, { code, message, ...extra });
}
