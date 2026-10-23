#!/bin/bash
set -e

# ... existing setup ...

function verify_governance_quorum() {
    local contract_id=$1
    local expected_quorum=$2
    local total_weight=$(stellar contract invoke --id "$contract_id" -- fn get_total_weight)
    
    if [ "$total_weight" -lt "$expected_quorum" ]; then
        echo "Error: Governance quorum check failed. Total weight: $total_weight, Required: $expected_quorum"
        exit 1
    fi
    echo "Governance quorum verified: $total_weight"
}

# Deployment flow
echo "Seeding governance voters..."
# ... logic to invoke initialize with voters ...

verify_governance_quorum "$GOVERNANCE_ID" 1000

echo "Handoff complete."
