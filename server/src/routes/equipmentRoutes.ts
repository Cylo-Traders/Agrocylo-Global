import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { prisma } from "../config/database.js";
import { ApiError } from "../http/errors.js";
import { requireWallet, type WalletRequest } from "../middleware/walletAuth.js";

const router = Router();

// Create new Equipment/Input/Tool listing
router.post("/equipment/listings", requireWallet, async (req: WalletRequest, res: Response, next: NextFunction) => {
  try {
    const ownerWallet = req.walletAddress;

    const {
      title,
      description,
      listingType,
      pricePerUnit,
      depositAmount = 0,
      currency,
      unit,
      location,
    } = req.body;

    if (!ownerWallet || !title || !listingType || pricePerUnit === undefined || !currency || !unit) {
      throw new ApiError(400, "Validation Error", "title, listingType, pricePerUnit, currency, and unit are required");
    }

    if (!["SEED", "TOOL", "EQUIPMENT_RENTAL"].includes(listingType)) {
      throw new ApiError(400, "Invalid Listing Type", "listingType must be SEED, TOOL, or EQUIPMENT_RENTAL");
    }

    const listing = await prisma.equipmentListing.create({
      data: {
        ownerWallet,
        title,
        description,
        listingType,
        pricePerUnit,
        depositAmount,
        currency,
        unit,
        location,
      },
    });

    res.status(201).json(listing);
  } catch (err) {
    next(err);
  }
});

// List equipment/inputs with filtering
router.get("/equipment/listings", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { listingType, ownerWallet } = req.query;

    const where: Record<string, unknown> = { isAvailable: true };
    if (listingType) where.listingType = String(listingType);
    if (ownerWallet) where.ownerWallet = String(ownerWallet);

    const listings = await prisma.equipmentListing.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { rentals: true },
    });

    res.json(listings);
  } catch (err) {
    next(err);
  }
});

// Rent equipment / tools with deposit
router.post("/equipment/rent", requireWallet, async (req: WalletRequest, res: Response, next: NextFunction) => {
  try {
    const renterWallet = req.walletAddress;
    const { listingId, startDate, endDate } = req.body;

    if (!listingId || !renterWallet || !startDate || !endDate) {
      throw new ApiError(400, "Validation Error", "listingId, startDate, and endDate are required");
    }

    const listing = await prisma.equipmentListing.findUnique({ where: { id: listingId } });
    if (!listing) {
      throw new ApiError(404, "Not Found", "Equipment listing not found");
    }

    if (!listing.isAvailable) {
      throw new ApiError(400, "Unavailable", "This equipment is currently unavailable for rental");
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (start >= end) {
      throw new ApiError(400, "Invalid Rental Dates", "startDate must be before endDate");
    }

    const rental = await prisma.equipmentRental.create({
      data: {
        listingId,
        renterWallet,
        startDate: start,
        endDate: end,
        status: "ACTIVE",
        depositAmount: listing.depositAmount,
        depositRefunded: false,
      },
    });

    res.status(201).json(rental);
  } catch (err) {
    next(err);
  }
});

// Return equipment and trigger deposit refund
router.post("/equipment/rentals/:id/return", requireWallet, async (req: WalletRequest, res: Response, next: NextFunction) => {
  try {
    const caller = req.walletAddress;
    const { id } = req.params;
    const { confirmCondition } = req.body;

    const rental = await prisma.equipmentRental.findUnique({
      where: { id },
      include: { listing: true },
    });

    if (!rental) {
      throw new ApiError(404, "Not Found", "Rental record not found");
    }

    if (rental.status === "RETURNED") {
      throw new ApiError(400, "Already Returned", "This rental has already been returned");
    }

    const isOwner = rental.listing.ownerWallet === caller;
    const isRenter = rental.renterWallet === caller;

    if (!isOwner && !isRenter) {
      throw new ApiError(403, "Forbidden", "Only the renter or listing owner can confirm return");
    }

    // Only the listing owner can authorise a deposit refund
    const depositRefunded = confirmCondition === true && isOwner;
    const status = "RETURNED";

    const updatedRental = await prisma.equipmentRental.update({
      where: { id },
      data: { status, depositRefunded },
    });

    res.json({
      rental: updatedRental,
      message: depositRefunded
        ? `Equipment returned successfully. Deposit of ${rental.depositAmount} ${rental.listing.currency} refunded.`
        : isOwner
          ? `Deposit withheld. Confirmed by owner.`
          : `Equipment returned. Deposit withheld pending owner inspection.`,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
