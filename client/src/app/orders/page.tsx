"use client";

import { Suspense } from "react";
import CreateOrderForm from "@/components/orders/CreateOrderForm";

export default function OrdersPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-neutral-50 to-white py-12 px-4">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-foreground mb-2 text-center">
          Orders
        </h1>
        <p className="text-muted text-center mb-8">
          Create escrow-backed orders with farmers on the Stellar network.
        </p>

        <Suspense fallback={<div className="text-center text-muted">Loading...</div>}>
          <div className="mb-12">
            <CreateOrderForm />
          </div>
        </Suspense>
      </div>
    </div>
  );
}
