import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { runWithLogContext } from "../config/logContext.js";

export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header("x-request-id");
  const requestId = (incoming && incoming.trim()) ? incoming.trim() : randomUUID();

  res.setHeader("x-request-id", requestId);

  runWithLogContext({ requestId }, () => next());
}

