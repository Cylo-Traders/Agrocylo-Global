#!/usr/bin/env bash
set -euo pipefail

# Agrocylo-Global Contract Deployment and Verification Script

GUARDIAN_ADDRESS="${GUARDIAN_ADDRESS:-}"
ATTESTER_ADDRESS="${ATTESTER_ADDRESS:-}"

if [ -z "$GUARDIAN_ADDRESS" ]; then
  echo "Error: GUARDIAN_ADDRESS is required for deployment and attestation wiring."
  exit 1
fi

if [ -z "$ATTESTER_ADDRESS" ]; then
  echo "Error: ATTESTER_ADDRESS is required for deployment and attestation wiring."
  exit 1
fi

echo "Starting contract deployment with Guardian: $GUARDIAN_ADDRESS and Attester: $ATTESTER_ADDRESS"

# Placeholder for actual stellar contract invocation steps
# Line 469: Setting guardian role
stellar contract invoke --id "$PRODUCTION_ESCROW_CONTRACT_ID" --set_guardian --new_guardian "$GUARDIAN_ADDRESS"

# Line 494: Setting attester role and verification readback
stellar contract invoke --id "$PRODUCTION_ESCROW_CONTRACT_ID" --set_attester --new_attester "$ATTESTER_ADDRESS"

# Verify configured guardian and attester values match expected inputs
CONFIGURED_GUARDIAN=$(stellar contract invoke --id "$PRODUCTION_ESCROW_CONTRACT_ID" --get_guardian)
CONFIGURED_ATTESTER=$(stellar contract invoke --id "$PRODUCTION_ESCROW_CONTRACT_ID" --get_attester)

if [ "$CONFIGURED_GUARDIAN" != "$GUARDIAN_ADDRESS" ]; then
  echo "Error: Guardian verification failed! Expected $GUARDIAN_ADDRESS, got $CONFIGURED_GUARDIAN"
  exit 1
fi

if [ "$CONFIGURED_ATTESTER" != "$ATTESTER_ADDRESS" ]; then
  echo "Error: Attester verification failed! Expected $ATTESTER_ADDRESS, got $CONFIGURED_ATTESTER"
  exit 1
fi

echo "Deployment and role verification completed successfully."
