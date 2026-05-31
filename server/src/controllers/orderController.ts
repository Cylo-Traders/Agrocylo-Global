import type { Request, Response } from "express";
import logger from "../config/logger.js";
import { OrderService } from "../services/orderService.js";
import { prisma } from "../config/database.js";

export class OrderController {
  static async getAllOrders(req: Request, res: Response) {
    try {
      const orders = await OrderService.getAll();
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
      const order = await OrderService.getByOrderId(id);
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }
      return res.status(200).json(order);
    } catch (error) {
      logger.error("Error fetching order " + id + ":", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  static async getOrdersByBuyer(req: Request, res: Response) {
    const { address } = req.params;
    if (!address) return res.status(400).json({ error: "Buyer address is required" });
    try {
      const orders = await OrderService.getByBuyerAddress(address);
      return res.status(200).json(orders);
    } catch (error) {
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  static async getOrdersBySeller(req: Request, res: Response) {
    const { address } = req.params;
    if (!address) return res.status(400).json({ error: "Seller address is required" });
    try {
      const orders = await OrderService.getByFarmerAddress(address);
      return res.status(200).json(orders);
    } catch (error) {
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  static async getSellerStats(req: Request, res: Response) {
    const { sellerAddress } = req.params;
    try {
      const orders = await prisma.order.findMany({
        where: { sellerAddress },
        include: { dispute: true },
      });
      const totalOrders = orders.length;
      if (totalOrders === 0) {
        return res.status(200).json({ totalOrders: 0, successRate: 100, disputeRate: 0, refundRatio: 0 });
      }
      const successfulOrders = orders.filter((o) => o.status === "COMPLETED").length;
      const disputedOrders = orders.filter((o) => o.dispute !== null).length;
      const refundedOrders = orders.filter((o) => o.status === "REFUNDED").length;
      return res.status(200).json({
        totalOrders,
        successRate: (successfulOrders / totalOrders) * 100,
        disputeRate: (disputedOrders / totalOrders) * 100,
        refundRatio: (refundedOrders / totalOrders) * 100,
      });
    } catch (error) {
      return res.status(500).json({ error: "Internal server error" });
    }
  }
}
