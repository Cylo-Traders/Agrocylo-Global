import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { prisma } from "../config/database.js";
import { ApiError } from "../http/errors.js";

const router = Router();

// Create a new CropPlan
router.post("/crop-plans", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      farmerWallet,
      cropName,
      plantedDate,
      expectedHarvestStart,
      expectedHarvestEnd,
      expectedVolume,
      unit,
      region,
      linkedCampaignId,
      reminderDaysBefore = 7,
    } = req.body;

    if (!farmerWallet || !cropName || !plantedDate || !expectedHarvestStart || !expectedHarvestEnd) {
      throw new ApiError(400, "Validation Error", "farmerWallet, cropName, plantedDate, expectedHarvestStart, and expectedHarvestEnd are required");
    }

    const pDate = new Date(plantedDate);
    const hStart = new Date(expectedHarvestStart);
    const hEnd = new Date(expectedHarvestEnd);

    if (isNaN(pDate.getTime()) || isNaN(hStart.getTime()) || isNaN(hEnd.getTime())) {
      throw new ApiError(400, "Invalid Date", "Provided dates are invalid");
    }

    if (pDate > hStart) {
      throw new ApiError(400, "Invalid Date Range", "Planted date cannot be after expected harvest start date");
    }

    if (hStart > hEnd) {
      throw new ApiError(400, "Invalid Date Range", "Expected harvest start date cannot be after harvest end date");
    }

    const cropPlan = await prisma.cropPlan.create({
      data: {
        farmerWallet,
        cropName,
        plantedDate: pDate,
        expectedHarvestStart: hStart,
        expectedHarvestEnd: hEnd,
        expectedVolume: expectedVolume ? parseFloat(expectedVolume) : null,
        unit,
        region,
        linkedCampaignId,
        reminderDaysBefore,
      },
    });

    res.status(201).json(cropPlan);
  } catch (err) {
    next(err);
  }
});

// List farmer crop plans
router.get("/crop-plans", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { farmerWallet, region } = req.query;

    const where: Record<string, unknown> = {};
    if (farmerWallet) where.farmerWallet = String(farmerWallet);
    if (region) where.region = String(region);

    const cropPlans = await prisma.cropPlan.findMany({
      where,
      orderBy: { expectedHarvestStart: "asc" },
    });

    res.json(cropPlans);
  } catch (err) {
    next(err);
  }
});

// Non-PII aggregate harvest volume view for buyers
router.get("/crop-plans/aggregate", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { region, cropName, month, year } = req.query;

    const where: Record<string, unknown> = {};
    if (region) where.region = String(region);
    if (cropName) where.cropName = String(cropName);

    if (month && year) {
      const startDate = new Date(Number(year), Number(month) - 1, 1);
      const endDate = new Date(Number(year), Number(month), 0, 23, 59, 59);
      where.expectedHarvestStart = { gte: startDate, lte: endDate };
    }

    const cropPlans = await prisma.cropPlan.findMany({
      where,
      select: {
        cropName: true,
        expectedVolume: true,
        unit: true,
        region: true,
        expectedHarvestStart: true,
        expectedHarvestEnd: true,
      },
    });

    const summary = cropPlans.reduce((acc, plan) => {
      const key = `${plan.cropName}_${plan.unit || "units"}`;
      if (!acc[key]) {
        acc[key] = {
          cropName: plan.cropName,
          totalExpectedVolume: 0,
          unit: plan.unit || "units",
          region: plan.region,
          planCount: 0,
        };
      }
      acc[key].totalExpectedVolume += plan.expectedVolume || 0;
      acc[key].planCount += 1;
      return acc;
    }, {} as Record<string, { cropName: string; totalExpectedVolume: number; unit: string; region: string | null; planCount: number }>);

    res.json({
      region: region || "All Regions",
      aggregates: Object.values(summary),
    });
  } catch (err) {
    next(err);
  }
});

// Trigger/check harvest reminder for a crop plan
router.post("/crop-plans/:id/reminder", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const plan = await prisma.cropPlan.findUnique({ where: { id } });
    if (!plan) {
      throw new ApiError(404, "Not Found", "Crop plan not found");
    }

    const now = new Date();
    const daysUntilHarvest = Math.ceil((plan.expectedHarvestStart.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    let reminderTriggered = false;
    if (daysUntilHarvest <= plan.reminderDaysBefore && !plan.reminderSent) {
      reminderTriggered = true;
      await prisma.cropPlan.update({
        where: { id },
        data: { reminderSent: true },
      });

      try {
        await prisma.notification.create({
          data: {
            walletAddress: plan.farmerWallet,
            message: `Reminder: Your ${plan.cropName} harvest is expected in ${daysUntilHarvest} days. Consider listing your produce or opening a campaign now!`,
            type: "HARVEST_REMINDER",
          },
        });
      } catch {
        // Notification creation fallback
      }
    }

    res.json({
      cropPlanId: id,
      daysUntilHarvest,
      reminderTriggered,
      reminderSent: plan.reminderSent || reminderTriggered,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
