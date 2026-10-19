import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { handleUssdRequest } from "../services/ussd/ussdHandler.js";
import { sendProblem } from "../utils/problem.js";

const router = Router();

export type ProviderVerificationResult = "ok" | "unauthorized" | "unconfigured";

export function verifyProviderRequest(req: Request): ProviderVerificationResult {
  const secret = process.env.USSD_PROVIDER_SECRET;
  if (!secret) return "unconfigured";
  const reqSecret =
    req.headers["x-ussd-provider-secret"] ||
    req.headers["x-provider-secret"] ||
    req.headers["authorization"];
  return reqSecret === secret ? "ok" : "unauthorized";
}

function rejectProviderRequest(res: Response, result: ProviderVerificationResult): void {
  if (result === "unconfigured") {
    sendProblem(res, 503, "USSD provider authentication is not configured");
    return;
  }
  sendProblem(res, 401, "Unauthorized provider request");
}

router.post("/ussd", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const verification = verifyProviderRequest(req);
    if (verification !== "ok") {
      rejectProviderRequest(res, verification);
      return;
    }

    const { sessionId, phoneNumber, text } = req.body;

    if (!sessionId || !phoneNumber) {
      sendProblem(res, 400, "sessionId and phoneNumber are required");
      return;
    }

    const input = (text ?? "").trim();
    const response = await handleUssdRequest(sessionId, phoneNumber, input);

    res.set("Content-Type", "text/plain");
    res.status(200).send(response);
  } catch (err) {
    if (err instanceof Error && err.message.includes("Session phone number mismatch")) {
      sendProblem(res, 400, err.message);
      return;
    }
    next(err);
  }
});

router.post("/ussd/callback", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const verification = verifyProviderRequest(req);
    if (verification !== "ok") {
      rejectProviderRequest(res, verification);
      return;
    }
    const { sessionId, phoneNumber, status } = req.body;
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
