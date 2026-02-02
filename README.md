# AGROCYLO🌾
### Overview

Agrocylo is a decentralized application that enables direct trade between farmers and consumers using escrow smart contracts on the Stellar network. The platform removes intermediaries, ensures swift and fair payments, and builds trust through transparent, verifiable transactions.

Each purchase is secured using an a escrow mechanism: funds are locked when a customer places an order and are released only after the buyer confirms receipt of goods. This guarantees protection for both parties while maintaining full user custody.

This project is designed to be modular, extensible, and developer-friendly, making it suitable for real-world deployment.


### 🎯 Why Agrocylo
* Wider market reach and ease of payment - Small scale farmers face limited market access and fragmented payment systems.
* Post-harvest loss reduction - Farmers incure losses due to lack of storage facilities and limited market access 
* Higher farmer profit and lower consumer cost - enabled by peer-to-peer interaction between farmer and consumer (Absence of middleman).
* Digital transformation of agriculture - price discovery tools, demand/supply aggregation tools to aid data-driven production.

### Components

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

###  Target Users
a. Primary users
    * Farmers/Producers
    * Consumers/buyers

b. Secondary stakeholders
    * Platform operators: analytics, monitoring and support.
    * NGO’s, cooperatives or government programs promoting farmer inclusion

### 🛠️ Tech Stack (Example)

Blockchain: Stellar 

Smart Contracts: Rust (Soroban)

Frontend: Astro (React)

Wallets: Freighter 

Indexing: Custom event indexer / Subgraph-style service

Notifications: Webhooks, Firebase, or Push APIs

### 📦 Project Goals

Enable swift, fair, and transparent agricultural trade

### 🤝 Contributing

Contributions are welcome!
####To Contribute:
   Fork the repository
   Clone your Forked version
   cd contracts
   Build and create a PR
You can help by:

    Improving smart contract logic

    Enhancing UI/UX

    Adding indexing or notification services

    Writing documentation or tests

    Please open an issue or submit a pull request.




