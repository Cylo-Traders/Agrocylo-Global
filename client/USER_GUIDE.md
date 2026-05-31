# User Guide

## Getting Started

1. **Install Freighter Wallet** - Download the Freighter browser extension from [freighter.app](https://freighter.app)
2. **Connect Your Wallet** - Click "Connect Wallet" and approve the connection
3. **Complete Onboarding** - Set up your profile (display name, bio, role, location)
4. **Explore the Market** - Browse products, filter by category, search for items

## Market Usage

### Finding Products
- Browse the market from the homepage or `/market` page
- Use search and category filters to narrow results
- View product details including price, unit, location, and delivery window

### Placing Orders
1. Find a product you want to buy
2. Enter quantity and delivery deadline
3. Confirm the escrow order
4. Funds are locked in the Soroban smart contract
5. Farmer ships the goods
6. Confirm receipt to release payment to the farmer

## Escrow Transactions

Escrow transactions use Soroban smart contracts on Stellar:

1. **Create Order** - Buyer deposits funds into escrow contract
2. **Fulfillment** - Farmer ships goods to buyer
3. **Confirmation** - Buyer confirms receipt; funds released to farmer
4. **Dispute** - If goods don't arrive, buyer can open a dispute for admin resolution

### Fee Structure
- Platform fee: 3% of order value
- No additional gas fees on Stellar

## Barter System

Trade goods directly with other users without using currency:

1. Navigate to the Barter page
2. Click "Propose a Trade"
3. Enter recipient wallet address
4. List items you offer and items you want
5. Set expiry time (12h to 7 days)
6. Optionally include collateral for trust

## Wallet Connection

### Supported Wallets
- **Freighter** (desktop + mobile) - Recommended
- **xBull** (desktop only)
- **Rabet** (desktop only)

### Troubleshooting Wallet Issues
- Ensure your wallet extension is installed and unlocked
- On mobile, Freighter is recommended
- Network must match (testnet/mainnet)
- If connection times out, refresh and try again

## Transaction Status

After submitting a transaction, you'll see a feedback panel showing:
- **Pending** - Transaction is building
- **Confirming** - Waiting for blockchain confirmation
- **Success** - Transaction confirmed with hash
- **Failure** - Details about what went wrong

## FAQ

**Q: What networks are supported?**
A: Stellar testnet (for development) and mainnet (for production).

**Q: What currencies are accepted?**
A: STRK and USDC on Stellar.

**Q: How long do delivery windows last?**
A: Delivery windows are set by the farmer and can range from days to weeks.

**Q: Can I cancel an order?**
A: Orders in escrow can be refunded if the delivery deadline passes without confirmation.

**Q: Is my data secure?**
A: All transactions are on-chain via Soroban smart contracts. Profile data is stored on our backend.
