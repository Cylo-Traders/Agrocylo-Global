import express from "express";
import {
  getGovernanceProposal,
  listGovernanceProposals,
} from "../services/governanceService.js";

const router = express.Router();

router.get("/governance/proposals", async (_req, res, next) => {
  try {
    res.json(await listGovernanceProposals());
  } catch (error) {
    next(error);
  }
});

router.get("/governance/proposals/:id", async (req, res, next) => {
  try {
    const proposal = await getGovernanceProposal(req.params.id);
    if (!proposal) {
      res.status(404).json({ message: "Governance proposal not found" });
      return;
    }
    res.json(proposal);
  } catch (error) {
    next(error);
  }
});

export default router;
