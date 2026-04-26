import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface PriceAnalytics {
  timestamp: number;
  avg_price: number;
  median_price: number;
  volume: number;
  recent_trades: any[];
}

export class PriceEngine {
  static async getAnalytics(productName: string): Promise<PriceAnalytics> {
    const orders = await prisma.order.findMany({
      where: {
        product: {
          name: {
            contains: productName,
            mode: 'insensitive',
          },
        },
        status: 'COMPLETED',
      },
      include: {
        product: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 100,
    });

    if (orders.length === 0) {
      return {
        timestamp: Date.now(),
        avg_price: 0,
        median_price: 0,
        volume: 0,
        recent_trades: [],
      };
    }

    const prices = orders.map(o => parseFloat(o.amount) / (o.product ? 1 : 1)); // Assuming amount is total, need price per unit logic
    // Actually, pricePerUnit is in Product. Let's use that if available.
    const unitPrices = orders.map(o => o.product ? parseFloat(o.product.pricePerUnit) : parseFloat(o.amount));

    const avgPrice = unitPrices.reduce((a, b) => a + b, 0) / unitPrices.length;
    
    const sortedPrices = [...unitPrices].sort((a, b) => a - b);
    const mid = Math.floor(sortedPrices.length / 2);
    const medianPrice = sortedPrices.length % 2 !== 0 
      ? sortedPrices[mid] 
      : (sortedPrices[mid - 1] + sortedPrices[mid]) / 2;

    const volume = orders.reduce((a, b) => a + parseFloat(b.amount), 0);

    const recentTrades = orders.slice(0, 10).map(o => ({
      id: o.id,
      amount: o.amount,
      token: o.token,
      createdAt: o.createdAt,
    }));

    return {
      timestamp: Date.now(),
      avg_price: avgPrice,
      median_price: medianPrice,
      volume: volume,
      recent_trades: recentTrades,
    };
  }
}
