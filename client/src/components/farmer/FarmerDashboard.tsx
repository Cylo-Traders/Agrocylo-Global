"use client";

import React, { useState } from "react";
import { Container, Card, CardContent, Text, Button } from "@/components/ui";
import { useWallet } from "@/hooks/useWallet";
import { useFarmerOrders } from "@/hooks/useFarmerOrders";
import RevenueSummaryCards from "./RevenueSummaryCards";
import PendingDeliveries from "./PendingDeliveries";
import CompletedOrders from "./CompletedOrders";
import ProductsManagement from "./ProductsManagement";
import FarmerSettings from "./FarmerSettings";

type TabType = "deliveries" | "orders" | "products" | "settings";

export default function FarmerDashboard() {
  const { address, connected } = useWallet();
  const [activeTab, setActiveTab] = useState<TabType>("deliveries");

  const ordersData = useFarmerOrders({
    sellerAddress: address || "",
    pollInterval: 10000,
    autoStart: connected && !!address,
  });

  const tabs = [
    { id: "deliveries" as TabType, label: "Pending Deliveries", count: ordersData.pendingDeliveries.length },
    { id: "orders" as TabType, label: "Completed Orders", count: ordersData.completedOrders.length },
    { id: "products" as TabType, label: "Products", count: 0 },
    { id: "settings" as TabType, label: "Settings", count: 0 },
  ];

  const handleOrderUpdate = () => {
    ordersData.refresh();
  };

  if (!connected || !address) {
    return (
      <Container size="lg" className="py-8">
        <Card variant="elevated" padding="lg">
          <CardContent className="text-center py-12">
            <Text variant="h3" as="h3" className="mb-4">
              Connect Your Wallet
            </Text>
            <Text variant="body" muted className="mb-6">
              Please connect your wallet to access the Farmer Dashboard
            </Text>
          </CardContent>
        </Card>
      </Container>
    );
  }

  return (
    <Container size="lg" className="py-8">
      <div className="space-y-8">
        {/* Header */}
        <div className="text-center">
          <Text variant="h2" as="h2" className="mb-2">
            Farmer Dashboard
          </Text>
          <Text variant="body" muted>
            Manage your farm orders, products, and track your revenue
          </Text>
        </div>

        {/* Revenue Summary Cards */}
        <RevenueSummaryCards
          totalRevenue={ordersData.revenue.totalRevenue}
          pendingRevenue={ordersData.revenue.pendingRevenue}
          completedOrders={ordersData.revenue.completedOrders}
          pendingDeliveries={ordersData.revenue.pendingDeliveries}
          isLoading={ordersData.isLoading}
        />

        {/* Tab Navigation */}
        <Card variant="elevated" padding="lg">
          <CardContent className="p-0">
            <div className="flex flex-wrap border-b">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-6 py-3 font-medium text-sm border-b-2 transition-colors ${
                    activeTab === tab.id
                      ? "border-primary text-primary"
                      : "border-transparent text-muted hover:text-foreground"
                  }`}
                >
                  {tab.label}
                  {tab.count > 0 && (
                    <span className="ml-2 px-2 py-1 text-xs bg-muted rounded-full">
                      {tab.count}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Tab Content */}
        <Card variant="elevated" padding="lg">
          <CardContent>
            {activeTab === "deliveries" && (
              <div className="space-y-4">
                <Text variant="h3" as="h3">Pending Deliveries</Text>
                <PendingDeliveries
                  orders={ordersData.pendingDeliveries}
                  isLoading={ordersData.isLoading}
                  onOrderUpdate={handleOrderUpdate}
                />
              </div>
            )}

            {activeTab === "orders" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Text variant="h3" as="h3">Completed Orders</Text>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={ordersData.refresh}
                    disabled={ordersData.isLoading}
                  >
                    {ordersData.isLoading ? "Refreshing..." : "Refresh"}
                  </Button>
                </div>
                <CompletedOrders
                  orders={ordersData.completedOrders}
                  isLoading={ordersData.isLoading}
                />
              </div>
            )}

            {activeTab === "products" && (
              <ProductsManagement farmerAddress={address} />
            )}

            {activeTab === "settings" && (
              <FarmerSettings farmerAddress={address} />
            )}
          </CardContent>
        </Card>

        {/* Status Indicator */}
        <div className="flex items-center justify-center gap-4 text-sm text-muted">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${ordersData.isPolling ? "bg-green-500 animate-pulse" : "bg-gray-400"}`} />
            <span>
              {ordersData.isPolling ? "Live updates active" : "Updates paused"}
            </span>
          </div>
          <Text variant="caption">
            Last updated: {ordersData.lastUpdated.toLocaleTimeString()}
          </Text>
        </div>
      </div>
    </Container>
  );
}
