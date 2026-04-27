import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PriceEngine } from '../price-engine/index.js';

const prisma = new PrismaClient();

export const getCampaigns = async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const [campaigns, total] = await Promise.all([
      prisma.campaign.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { investments: true } } },
      }),
      prisma.campaign.count(),
    ]);

    res.json({
      data: campaigns,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getCampaignById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const campaign = await prisma.campaign.findUnique({
      where: { id },
      include: { investments: true },
    });

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    res.json(campaign);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getCampaignsByFarmer = async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    const campaigns = await prisma.campaign.findMany({
      where: { farmerAddress: address },
      orderBy: { createdAt: 'desc' },
    });

    res.json(campaigns);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getInvestmentsByAddress = async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    const investments = await prisma.investment.findMany({
      where: { investor: address },
      include: { campaign: true },
      orderBy: { createdAt: 'desc' },
    });

    res.json(investments);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getCampaignInvestors = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const investments = await prisma.investment.findMany({
      where: { campaignId: id },
      orderBy: { createdAt: 'desc' },
    });

    res.json(investments);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getPriceAnalytics = async (req: Request, res: Response) => {
  try {
    const product = req.query.product as string;
    if (!product) {
      return res.status(400).json({ error: 'Product name is required' });
    }

    const analytics = await PriceEngine.getAnalytics(product);
    res.json(analytics);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
