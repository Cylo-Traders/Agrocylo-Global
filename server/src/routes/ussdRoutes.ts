import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { handleUssdRequest } from "../services/ussd/ussdHandler.js";

const router = Router();

export function verifyProviderRequest(req: Request): boolean {
  const secret = process.env.USSD_PROVIDER_SECRET;
  if (!secret) return true;
  const reqSecret =
    req.headers["x-ussd-provider-secret"] ||
    req.headers["x-provider-secret"] ||
    req.headers["authorization"];
  return reqSecret === secret;
}

router.post("/ussd", async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!verifyProviderRequest(req)) {
      res.status(401).json({ error: "Unauthorized provider request" });
      return;
    }

    const { sessionId, phoneNumber, text } = req.body;

    if (!sessionId || !phoneNumber) {
      res.status(400).json({ error: "sessionId and phoneNumber are required" });
      return;
    }

    const input = (text ?? "").trim();
    const response = await handleUssdRequest(sessionId, phoneNumber, input);

    res.set("Content-Type", "text/plain");
    res.status(200).send(response);
  } catch (err) {
    if (err instanceof Error && err.message.includes("Session phone number mismatch")) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

router.post("/ussd/callback", async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!verifyProviderRequest(req)) {
      res.status(401).json({ error: "Unauthorized provider request" });
      return;
    }
    const { sessionId, phoneNumber, status } = req.body;
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
