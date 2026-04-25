import type { Request, Response } from "express";
import { prisma } from "../config/database.js";
import logger from "../config/logger.js";

export class OrderController {
  static async getAllOrders(req: Request, res: Response) {
    try {
      const orders = await prisma.order.findMany({
        include: { product: true, buyerUser: true, sellerUser: true },
        orderBy: { createdAt: "desc" },
      });
      return res.status(200).json(orders);
    } catch (error) {
      logger.error("Error fetching all orders:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  static async getOrderById(req: Request, res: Response) {
    const { id } = req.params;
    try {
      const order = await prisma.order.findUnique({
        where: { orderIdOnChain: id },
        include: { product: true, buyerUser: true, sellerUser: true },
      });
      if (!order) return res.status(404).json({ error: "Order not found" });
      return res.status(200).json(order);
    } catch (error) {
      logger.error("Error fetching order " + id + ":", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  static async getOrdersByBuyer(req: Request, res: Response) {
    const { address } = req.params;
    try {
      const orders = await prisma.order.findMany({
        where: { buyerAddress: address },
        include: { product: true, sellerUser: true }
      });
      return res.status(200).json(orders);
    } catch (error) {
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  static async getOrdersBySeller(req: Request, res: Response) {
    const { address } = req.params;
    try {
      const orders = await prisma.order.findMany({
        where: { sellerAddress: address },
        include: { product: true, buyerUser: true }
      });
      return res.status(200).json(orders);
    } catch (error) {
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  static async getSellerStats(req: Request, res: Response) {
    const { sellerAddress } = req.params;
    try {
      const orders = await prisma.order.findMany({
        where: { sellerAddress: sellerAddress },
        include: { disputes: true }
      });
      const totalOrders = orders.length;
      if (totalOrders === 0) {
        return res.status(200).json({ totalOrders: 0, successRate: 100, disputeRate: 0, refundRatio: 0 });
      }
      const successfulOrders = orders.filter((o: any) => o.status === 'RELEASED').length;
      const disputedOrders = orders.filter((o: any) => o.disputes.length > 0).length;
      const refundedOrders = orders.filter((o: any) => o.status === 'REFUNDED').length;
      return res.status(200).json({
        totalOrders,
        successRate: (successfulOrders / totalOrders) * 100,
        disputeRate: (disputedOrders / totalOrders) * 100,
        refundRatio: (refundedOrders / totalOrders) * 100,
      });
    } catch (error) {
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
}
