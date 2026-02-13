# AGROCYLO🌾
### Overview

Agrocylo is a decentralized application that enables peer-to-peer trade between farmers and consumers using escrow smart contracts on the Stellar network. The platform removes intermediaries, ensures swift and fair payments, and verifiable transactions.

Each purchase is secured using an a escrow mechanism: funds are locked when a customer places an order and are released only after the buyer confirms receipt of goods. This guarantees protection for both parties while maintaining full user custody.

### ✨ Features
* On-chain escrow settlement - Funds are locked in an escrow smart contract until buyers confirm receipt of goods.

* Non-custodial payments - Users retain full control of funds at all times.

* Peer-to-peer Farmer-Consumer Marketplace - Farmers sell directly to consumers without middlemen, retaining price control and increasing income.

* Token-based payment - Supports stablecoin and token payments (USDC and XLM)

* Buyer-confirmed settlement - Funds are never released to farmer/seller until the buyer confirms receipt of goods.

* Unlimited parallel transactions - Unlimited concurrent trades can be carried out at a time, and each transaction is tracked by ID, time, status, amount, and associated addresses.

* Order indexing by role - Buyers can view all their purchases and order statuses. Farmers can track incoming orders and pending payments.

* Real-time updates and notifications - On-chain events are indexed and transmitted off-chain to deliver real-time order updates and notifications.

### 🎯 Why Agrocylo
* Wider market reach and ease of payment - Small scale farmers face limited market access and fragmented payment systems.
* Post-harvest loss reduction - Farmers incure losses due to lack of storage facilities and limited market access 
* Higher farmer profit and lower consumer cost - enabled by peer-to-peer interaction between farmer and consumer (Absence of middleman).
* Digital transformation of agriculture - price discovery tools, demand/supply aggregation tools to aid data-driven production.

###  Target Users
a. Primary users
    * Farmers/Producers
    * Consumers/buyers

b. Secondary stakeholders
    * Platform operators: analytics, monitoring and support.
    * NGO’s, cooperatives or government programs promoting farmer inclusion


### 🏗 COMPONENTS (DEVELOPMENT) 

#### Smart Contracts

Escrow creation

Order lifecycle management

Dispute handling 

#### Frontend

Farmer dashboards

Consumer checkout & order tracking

Wallet integration

#### Off-Chain Services

Event indexing

Notifications (email, push, in-app)

Analytics and reporting

### 🧱 Architecture
Frontend (Web / Mobile)

   ↓
Smart Contracts (Escrow)

   ↓
Stellar Network

   ↓
Off-Chain Indexers & Notification Services

┌─────────────────┐
│   FRONTEND      │
│ (Web/Mobile)    │
└────────┬────────┘
         │
         ├
         │
         └---------─┐
                    │
               ┌────▼───────────┐
               │Smart Contracts │
               │ (Soroban Rust) │----------─┐
               └────┬───────────┘           |
                                            │
                                       ┌────▼───────────┐
                                       │   Backend      |
                                       │                │
                                       └────────────────┘

### 🛠️ Tech Stack

Network: Stellar Testnet

Smart Contracts: Rust (Soroban)

Frontend: Astro (React)

Wallets: Freighter 

Indexing: Custom event indexer / Subgraph-style service

Notifications: Webhooks, Firebase, or Push APIs

### 📦 Project Goals

Enable swift, fair, and transparent trade

### 🤝 Contributing

### Contributions are welcome!
#### To Contribute:

   * Fork the repository
   * Clone your Forked version
   * cd contracts
   * Build and create a PR
#### You can assist by:
    * Improving smart contract logic
    * Enhancing UI/UX
    * Adding indexing or notification services
    * Writing documentation or tests
    * Please open an issue or submit a pull request.




