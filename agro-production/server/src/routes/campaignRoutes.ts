import { Router } from 'express';
import {
  getCampaigns,
  getCampaignById,
  getCampaignsByFarmer,
  getInvestmentsByAddress,
  getCampaignInvestors,
  getPriceAnalytics,
} from '../controllers/campaignController.js';

const router = Router();

// Campaign routes
router.get('/campaigns', getCampaigns);
router.get('/campaigns/:id', getCampaignById);
router.get('/campaigns/farmer/:address', getCampaignsByFarmer);

// Investment routes
router.get('/investments/:address', getInvestmentsByAddress);
router.get('/campaigns/:id/investors', getCampaignInvestors);

// Analytics routes
router.get('/analytics/price-history', getPriceAnalytics);

export default router;
