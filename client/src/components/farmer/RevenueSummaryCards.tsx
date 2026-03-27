"use client";

import React from "react";
import { Card, CardContent, Text } from "@/components/ui";

interface RevenueSummaryCardsProps {
  totalRevenue: number;
  pendingRevenue: number;
  completedOrders: number;
  pendingDeliveries: number;
  currency?: string;
  isLoading?: boolean;
}

export default function RevenueSummaryCards({
  totalRevenue,
  pendingRevenue,
  completedOrders,
  pendingDeliveries,
  currency = "XLM",
  isLoading = false,
}: RevenueSummaryCardsProps) {
  const cards = [
    {
      title: "Total Revenue",
      value: isLoading ? "..." : `${totalRevenue.toFixed(2)} ${currency}`,
      subtitle: "All time earnings",
      color: "bg-green-50 border-green-200",
      textColor: "text-green-700",
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      title: "Pending Revenue",
      value: isLoading ? "..." : `${pendingRevenue.toFixed(2)} ${currency}`,
      subtitle: "Awaiting delivery confirmation",
      color: "bg-yellow-50 border-yellow-200",
      textColor: "text-yellow-700",
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      title: "Completed Orders",
      value: isLoading ? "..." : completedOrders.toString(),
      subtitle: "Successfully delivered",
      color: "bg-blue-50 border-blue-200",
      textColor: "text-blue-700",
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      title: "Pending Deliveries",
      value: isLoading ? "..." : pendingDeliveries.toString(),
      subtitle: "Orders to fulfill",
      color: "bg-purple-50 border-purple-200",
      textColor: "text-purple-700",
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
        </svg>
      ),
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      {cards.map((card, index) => (
        <Card
          key={index}
          variant="elevated"
          padding="lg"
          className={`${card.color} border`}
        >
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <div className={`${card.textColor}`}>
                {card.icon}
              </div>
              {isLoading && (
                <div className="w-4 h-4 bg-current rounded-full animate-pulse opacity-50" />
              )}
            </div>
            <div>
              <Text variant="h3" as="h3" className={`${card.textColor} font-bold`}>
                {card.value}
              </Text>
              <Text variant="body" muted className={card.textColor}>
                {card.title}
              </Text>
              <Text variant="caption" className={card.textColor}>
                {card.subtitle}
              </Text>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
