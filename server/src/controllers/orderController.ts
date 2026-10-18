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

export class OrderController {
  static async getAllOrders(req: Request, res: Response) {
    try {
      const walletReq = req as WalletRequest;
      const walletAddress = walletReq.walletAddress;
      if (!walletAddress) {
        sendProblem(res, req, new AuthError("Authentication required to view orders"));
        return;
      }
      const orders = await OrderService.getAllForWallet(walletAddress);
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

      if (order.buyerAddress !== walletAddress && order.sellerAddress !== walletAddress) {
        sendProblem(
          res,
          req,
          new ForbiddenError("Forbidden: you do not have permission to access this order"),
        );
        return;
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

      if (walletAddress.toLowerCase() !== address.toLowerCase()) {
        sendProblem(
          res,
          req,
          new ForbiddenError("Forbidden: you can only view orders placed by your own wallet"),
        );
        return;
      }

      const orders = await OrderService.getByBuyerAddress(address);
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

      if (walletAddress.toLowerCase() !== address.toLowerCase()) {
        sendProblem(
          res,
          req,
          new ForbiddenError("Forbidden: you can only view orders sold by your own wallet"),
        );
        return;
      }

      const orders = await OrderService.getByFarmerAddress(address);
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

      if (walletAddress.toLowerCase() !== sellerAddress.toLowerCase()) {
        sendProblem(
          res,
          req,
          new ForbiddenError("Forbidden: you can only view statistics for your own wallet"),
        );
        return;
      }

      const stats = await OrderService.getSellerStats(sellerAddress);
      res.status(200).json(stats);
    } catch (error) {
      handleServiceError(error, req, res);
    }
  }
}
