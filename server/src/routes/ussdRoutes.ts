import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { handleUssdRequest } from "../services/ussd/ussdHandler.js";

const router = Router();

router.post("/ussd", async (req: Request, res: Response, next: NextFunction) => {
  try {
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
    next(err);
  }
});

router.post("/ussd/callback", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { sessionId, phoneNumber, status } = req.body;
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
