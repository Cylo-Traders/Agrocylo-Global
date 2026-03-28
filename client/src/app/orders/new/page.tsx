"use client";

import { Suspense } from "react";
import CreateOrderForm from "@/components/orders/CreateOrderForm";

export default function NewOrderPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-neutral-50 to-white py-12 px-4">
      <Suspense fallback={<div className="text-center text-muted py-12">Loading...</div>}>
        <CreateOrderForm />
      </Suspense>
    </div>
  );
}
