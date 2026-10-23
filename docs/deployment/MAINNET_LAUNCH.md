# Mainnet Launch Runbook

This document outlines the mandatory steps for deploying and verifying Agrocylo contracts on Stellar Mainnet.

## 1. Prerequisites
- Ensure `GUARDIAN_ADDRESS` and `ATTESTER_ADDRESS` environment variables are explicitly exported.
- Run the deployment script with correct parameters.

## 2. Deployment and Role Verification
- The deployment script automatically calls `set_guardian` and `set_attester` on applicable contracts.
- Verification checks ensure the live chain state matches expected values; missing or mismatched roles will cause deployment readiness checks to fail immediately.
- Verify pause/unpause drills and independent harvest attestation flows post-deployment.
