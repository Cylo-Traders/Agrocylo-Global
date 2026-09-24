import express from "express";
import { requireWallet, type WalletRequest } from "../middleware/walletAuth.js";
import { ApiError, sendProblem } from "../http/errors.js";
import { executeGraphQL } from "../services/graphqlGatewayService.js";

const router = express.Router();

router.post("/", requireWallet, async (req: WalletRequest, res, next) => {
  try {
    if (!req.walletAddress) {
      throw new ApiError(401, "Unauthorized", "Missing wallet");
    }

    const query = typeof req.body?.query === "string" ? req.body.query : "";
    if (!query.trim()) {
      throw new ApiError(400, "Bad Request", "query is required");
    }

    const variables =
      req.body && typeof req.body.variables === "object" && req.body.variables !== null
        ? (req.body.variables as Record<string, unknown>)
        : {};

    const result = await executeGraphQL(query, variables, req.walletAddress, req.walletRole);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

export function graphqlErrorHandler(
  error: unknown,
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  if (error instanceof ApiError) {
    sendProblem(res, req, error);
    return;
  }

  next(error);
}

export default router;

