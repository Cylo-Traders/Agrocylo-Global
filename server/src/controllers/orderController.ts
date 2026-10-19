import type { Request, Response } from "express";
import { OrderService } from "../services/orderService.js";
import type { WalletRequest } from "../middleware/walletAuth.js";
import {
  AuthError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  handleServiceError,
  sendProblem,
} from "../http/errors.js";

// Stellar addresses are checksummed mixed-case while identity/order rows are
// persisted canonical-lowercase. Canonicalize once at the boundary so every
// comparison and lookup below is case-insensitive (#1211).
const canonicalizeWallet = (address: string): string => address.toLowerCase();

export class OrderController {
  static async getAllOrders(req: Request, res: Response) {
    try {
      const walletReq = req as WalletRequest;
      const walletAddress = walletReq.walletAddress;
      if (!walletAddress) {
        sendProblem(res, req, new AuthError("Authentication required to view orders"));
        return;
      }
      const orders = await OrderService.getAllForWallet(canonicalizeWallet(walletAddress));
      res.status(200).json(orders);
    } catch (error) {
      handleServiceError(error, req, res);
    }
  }

  static async getOrderById(req: Request, res: Response) {
    const { id } = req.params;
    if (!id) {
      sendProblem(res, req, new ValidationError("Order id path parameter is required"));
      return;
    }

    try {
      const walletReq = req as WalletRequest;
      const walletAddress = walletReq.walletAddress;
      if (!walletAddress) {
        sendProblem(res, req, new AuthError("Authentication required to view order"));
        return;
      }

      const order = await OrderService.getByOrderId(id);
      if (!order) {
        sendProblem(res, req, new NotFoundError("Order", id));
        return;
      }
      // Identity rows are stored lower-cased while callers send checksummed
      // addresses — compare case-insensitively (#1184/#1211).
      const principal = canonicalizeWallet(walletAddress);
      if (
        order.buyerAddress?.toLowerCase() !== principal &&
        order.sellerAddress?.toLowerCase() !== principal
      ) {
        return res.status(403).json({ error: "Forbidden: you do not have access to this order" });
      }

      res.status(200).json(order);
    } catch (error) {
      handleServiceError(error, req, res);
    }
  }

  static async getOrdersByBuyer(req: Request, res: Response) {
    const { address } = req.params;
    if (!address) {
      sendProblem(res, req, new ValidationError("Buyer address path parameter is required"));
      return;
    }

    try {
      const walletReq = req as WalletRequest;
      const walletAddress = walletReq.walletAddress;
      if (!walletAddress) {
        sendProblem(res, req, new AuthError("Authentication required to view buyer orders"));
        return;
      }
      const buyerAddress = canonicalizeWallet(address);
      if (canonicalizeWallet(walletAddress) !== buyerAddress) {
        return res.status(403).json({ error: "Forbidden: you can only view your own orders" });
      }

      const orders = await OrderService.getByBuyerAddress(buyerAddress);
      res.status(200).json(orders);
    } catch (error) {
      handleServiceError(error, req, res);
    }
  }

  static async getOrdersBySeller(req: Request, res: Response) {
    const { address } = req.params;
    if (!address) {
      sendProblem(res, req, new ValidationError("Seller address path parameter is required"));
      return;
    }

    try {
      const walletReq = req as WalletRequest;
      const walletAddress = walletReq.walletAddress;
      if (!walletAddress) {
        sendProblem(res, req, new AuthError("Authentication required to view seller orders"));
        return;
      }
      const sellerAddress = canonicalizeWallet(address);
      if (canonicalizeWallet(walletAddress) !== sellerAddress) {
        return res.status(403).json({ error: "Forbidden: you can only view your own orders" });
      }

      const orders = await OrderService.getByFarmerAddress(sellerAddress);
      res.status(200).json(orders);
    } catch (error) {
      handleServiceError(error, req, res);
    }
  }

  static async getSellerStats(req: Request, res: Response) {
    const { sellerAddress } = req.params;
    if (!sellerAddress) {
      sendProblem(res, req, new ValidationError("Seller address path parameter is required"));
      return;
    }

    try {
      const walletReq = req as WalletRequest;
      const walletAddress = walletReq.walletAddress;
      if (!walletAddress) {
        sendProblem(res, req, new AuthError("Authentication required to view seller stats"));
        return;
      }
      const canonicalSeller = canonicalizeWallet(sellerAddress);
      if (canonicalizeWallet(walletAddress) !== canonicalSeller) {
        return res.status(403).json({ error: "Forbidden: you can only view your own stats" });
      }

      const stats = await OrderService.getSellerStats(canonicalSeller);
      res.status(200).json(stats);
    } catch (error) {
      handleServiceError(error, req, res);
    }
  }
}
