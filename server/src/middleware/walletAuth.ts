import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config/index.js";
import { HANDOFF_AUDIENCE, resolveWalletRole } from "../services/authService.js";
import { ApiError, sendProblem } from "../http/errors.js";

export interface WalletRequest extends Request {
  walletAddress?: string;
  walletRole?: string;
}

interface TokenPayload {
  walletAddress?: string;
  role?: string;
  aud?: string;
}

/**
 * Resolves the caller's verified session principal from a Bearer token, or
 * null when the token is missing, invalid, expired, or a handoff token.
 */
export function sessionPrincipal(req: Request): { walletAddress: string; role?: string } | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ') || !config.jwtSecret) return null;
  try {
    const decoded = jwt.verify(authHeader.slice(7), config.jwtSecret) as TokenPayload;
    if (!decoded.walletAddress || decoded.aud === HANDOFF_AUDIENCE) return null;
    return { walletAddress: decoded.walletAddress, role: decoded.role };
  } catch {
    return null;
  }
}

export function requireWallet(req: WalletRequest, res: Response, next: NextFunction): void {
  const authHeader = req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    sendProblem(res, req, new ApiError(401, 'Unauthorized', 'Missing or invalid Authorization header', 'https://cylos.io/errors/unauthorized'));
    return;
  }

  const token = authHeader.slice(7); // Remove 'Bearer ' prefix

  if (!config.jwtSecret) {
    sendProblem(res, req, new ApiError(500, 'Internal Server Error', 'Server configuration error: JWT secret is not set'));
    return;
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret) as TokenPayload;
    if (!decoded.walletAddress) {
      sendProblem(res, req, new ApiError(401, 'Unauthorized', 'Invalid token: missing walletAddress', 'https://cylos.io/errors/unauthorized'));
      return;
    }
    // A cross-app SSO handoff token (Issue #686) is single-purpose: it may
    // only be redeemed via POST /auth/handoff, never used directly as a
    // general session credential.
    if (decoded.aud === HANDOFF_AUDIENCE) {
      sendProblem(res, req, new ApiError(401, 'Unauthorized', 'Invalid token: not a session token', 'https://cylos.io/errors/unauthorized'));
      return;
    }
    // When callers also send an explicit wallet identity (header),
    // it must match the verified session — otherwise fail clearly instead
    // of silently acting on the wrong wallet (#1138).
    const headerWallet = req.header('x-wallet-address');
    if (
      headerWallet &&
      headerWallet.trim() &&
      !headerWallet.trim().startsWith('Bearer ') &&
      headerWallet.trim().toLowerCase() !== decoded.walletAddress.toLowerCase()
    ) {
      sendProblem(res, req, new ApiError(403, 'Forbidden', 'Wallet header does not match session', 'https://cylos.io/errors/forbidden'));
      return;
    }
    req.walletAddress = decoded.walletAddress;
    if (decoded.role) {
      req.walletRole = decoded.role;
    }
    next();
  } catch (_err) {
    sendProblem(res, req, new ApiError(401, 'Unauthorized', 'Invalid or expired token', 'https://cylos.io/errors/unauthorized'));
  }
}

export type WalletRole = 'FARMER' | 'BUYER' | 'ADMIN';

/**
 * Allows the request only when the verified session role is one of `roles`
 * (ADMIN always passes). Must run after requireWallet. Responds with a
 * Problem+JSON 403 on mismatch or missing role (#1133).
 *
 * The role carried in the JWT is a snapshot from token issue time, so it can
 * be stale (e.g. a farmer selects their role during onboarding *after* the
 * token was minted). When the snapshot fails the check we re-resolve the role
 * from the DB before rejecting, so a freshly-granted role takes effect without
 * forcing a re-login (#1185).
 */
export function requireAnyRole(...roles: WalletRole[]) {
  const allows = (role?: string): boolean => {
    if (!role) return false;
    return role === 'ADMIN' || (roles as readonly string[]).includes(role);
  };

  return (req: WalletRequest, res: Response, next: NextFunction): void => {
    if (allows(req.walletRole)) {
      next();
      return;
    }
    if (!req.walletAddress) {
      sendProblem(
        res,
        req,
        new ApiError(403, 'Forbidden', `Requires role: ${roles.join(' or ')}`, 'https://cylos.io/errors/forbidden'),
      );
      return;
    }
    resolveWalletRole(req.walletAddress)
      .then((freshRole) => {
        if (allows(freshRole)) {
          req.walletRole = freshRole;
          next();
          return;
        }
        sendProblem(
          res,
          req,
          new ApiError(403, 'Forbidden', `Requires role: ${roles.join(' or ')}`, 'https://cylos.io/errors/forbidden'),
        );
      })
      .catch(() => {
        sendProblem(
          res,
          req,
          new ApiError(403, 'Forbidden', `Requires role: ${roles.join(' or ')}`, 'https://cylos.io/errors/forbidden'),
        );
      });
  };
}

export const requireRole = (role: WalletRole) => requireAnyRole(role);
