import type { Request, Response } from "express";
import logger from "../config/logger.js";
import { OrderService } from "../services/orderService.js";

export class OrderController {
  /**
   * GET /orders
   * Retrieve all orders
   */
  static async getAllOrders(req: Request, res: Response) {
    try {
      const orders = await OrderService.getAll();
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
    if (!id) return res.status(400).json({ error: "Order id is required" });
    try {
      const order = await OrderService.getByOrderId(id);

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
    if (!address) return res.status(400).json({ error: "Buyer address is required" });
    try {
      const orders = await OrderService.getByBuyerAddress(address);
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
  static async getOrdersByFarmer(req: Request, res: Response) {
    const { address } = req.params;
    if (!address) return res.status(400).json({ error: "Farmer address is required" });
    try {
      const orders = await OrderService.getByFarmerAddress(address);
      return res.status(200).json(orders);
    } catch (error) {
      logger.error(`Error fetching orders for farmer ${address}:`, error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  static async getOrdersBySeller(req: Request, res: Response) {
    return OrderController.getOrdersByFarmer(req, res);
  }
}
