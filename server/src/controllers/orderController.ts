import type { Request, Response } from "express";
import logger from "../config/logger.js";
import { OrderService } from "../services/orderService.js";
import type { WalletRequest } from "../middleware/walletAuth.js";

export class OrderController {
  static async getAllOrders(req: Request, res: Response) {
    try {
      const walletReq = req as WalletRequest;
      const walletAddress = walletReq.walletAddress;
      if (!walletAddress) {
        return res.status(401).json({ error: "Authentication required" });
      }
      const orders = await OrderService.getAllForWallet(walletAddress);
      return res.status(200).json(orders);
    } catch (error) {
      logger.error("Error fetching all orders:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  static async getOrderById(req: Request, res: Response) {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: "Order id is required" });
    try {
      const walletReq = req as WalletRequest;
      const walletAddress = walletReq.walletAddress;
      if (!walletAddress) {
        return res.status(401).json({ error: "Authentication required" });
      }
      const order = await OrderService.getByOrderId(id);
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }
      // Identity rows are stored lower-cased while callers send checksummed
      // addresses — compare case-insensitively (#1184/#1185).
      const principal = walletAddress.toLowerCase();
      if (
        order.buyerAddress?.toLowerCase() !== principal &&
        order.sellerAddress?.toLowerCase() !== principal
      ) {
        return res.status(403).json({ error: "Forbidden: you do not have access to this order" });
      }
      return res.status(200).json(order);
    } catch (error) {
      logger.error("Error fetching order " + id + ":", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  static async getOrdersByBuyer(req: Request, res: Response) {
    const { address } = req.params;
    if (!address)
      return res.status(400).json({ error: "Buyer address is required" });
    try {
      const walletReq = req as WalletRequest;
      const walletAddress = walletReq.walletAddress;
      if (!walletAddress) {
        return res.status(401).json({ error: "Authentication required" });
      }
      if (walletAddress.toLowerCase() !== address.toLowerCase()) {
        return res.status(403).json({ error: "Forbidden: you can only view your own orders" });
      }
      const orders = await OrderService.getByBuyerAddress(address);
      return res.status(200).json(orders);
    } catch (error) {
      logger.error("Error fetching buyer orders for " + address + ":", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  static async getOrdersBySeller(req: Request, res: Response) {
    const { address } = req.params;
    if (!address)
      return res.status(400).json({ error: "Seller address is required" });
    try {
      const walletReq = req as WalletRequest;
      const walletAddress = walletReq.walletAddress;
      if (!walletAddress) {
        return res.status(401).json({ error: "Authentication required" });
      }
      if (walletAddress.toLowerCase() !== address.toLowerCase()) {
        return res.status(403).json({ error: "Forbidden: you can only view your own orders" });
      }
      const orders = await OrderService.getByFarmerAddress(address);
      return res.status(200).json(orders);
    } catch (error) {
      logger.error("Error fetching seller orders for " + address + ":", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  static async getSellerStats(req: Request, res: Response) {
    const { sellerAddress } = req.params;
    if (!sellerAddress) {
      return res.status(400).json({ error: "Seller address is required" });
    }
    try {
      const walletReq = req as WalletRequest;
      const walletAddress = walletReq.walletAddress;
      if (!walletAddress) {
        return res.status(401).json({ error: "Authentication required" });
      }
      if (walletAddress.toLowerCase() !== sellerAddress.toLowerCase()) {
        return res.status(403).json({ error: "Forbidden: you can only view your own stats" });
      }
      const stats = await OrderService.getSellerStats(sellerAddress);
      return res.status(200).json(stats);
    } catch (error) {
      logger.error("Error fetching seller stats:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
}
