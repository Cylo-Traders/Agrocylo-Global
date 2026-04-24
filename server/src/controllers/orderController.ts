import type { Request, Response } from "express";
import { prisma } from "../config/database.js";
import logger from "../config/logger.js";

export class OrderController {
  /**
   * GET /orders
   * Retrieve all orders
   */
  static async getAllOrders(req: Request, res: Response) {
    try {
      const orders = await prisma.order.findMany({
        include: {
          product: true,
          buyerUser: true,
          sellerUser: true,
        },
        orderBy: { createdAt: "desc" },
      });
      return res.status(200).json(orders);
    } catch (error) {
      logger.error("Error fetching all orders:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  /**
   * GET /orders/:id
   * Retrieve a single order by its on-chain ID
   */
  static async getOrderById(req: Request, res: Response) {
    const { id } = req.params;
    try {
      const order = await prisma.order.findUnique({
        where: { orderIdOnChain: id },
        include: {
          product: true,
          buyerUser: true,
          sellerUser: true,
        },
      });

      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      return res.status(200).json(order);
    } catch (error) {
      logger.error(`Error fetching order ${id}:`, error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  /**
   * GET /orders/buyer/:address
   * Retrieve all orders for a specific buyer address
   */
  static async getOrdersByBuyer(req: Request, res: Response) {
    const { address } = req.params;
    try {
      const orders = await prisma.order.findMany({
        where: { buyerAddress: address },
        include: {
          product: true,
          sellerUser: true,
        },
        orderBy: { createdAt: "desc" },
      });
      return res.status(200).json(orders);
    } catch (error) {
      logger.error(`Error fetching orders for buyer ${address}:`, error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  /**
   * GET /orders/seller/:address
   * Retrieve all orders for a specific seller address
   */
  static async getOrdersBySeller(req: Request, res: Response) {
    const { address } = req.params;
    try {
      const orders = await prisma.order.findMany({
        where: { sellerAddress: address },
        include: {
          product: true,
          buyerUser: true,
        },
        orderBy: { createdAt: "desc" },
      });
      return res.status(200).json(orders);
    } catch (error) {
      logger.error(`Error fetching orders for seller ${address}:`, error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  /**
   * GET /orders/farmer/:address
   * Retrieve all orders for a specific farmer address
   */
  static async getOrdersByFarmer(req: Request, res: Response) {
    const { address } = req.params;
    try {
      const orders = await prisma.order.findMany({
        where: { sellerAddress: address },
        include: {
          product: true,
          buyerUser: true,
        },
        orderBy: { createdAt: "desc" },
      });
      return res.status(200).json(orders);
    } catch (error) {
      logger.error(`Error fetching orders for farmer ${address}:`, error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
}
