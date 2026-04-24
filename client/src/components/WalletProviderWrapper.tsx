"use client";

import React from "react";
import { WalletProvider } from "../context/WalletContext";
import Navbar from "./Navbar";
import { CartProvider } from "@/context/CartContext";
import CartDrawer from "./CartDrawer";
import NotificationPoller from "./NotificationPoller";

export default function WalletProviderWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <WalletProvider>
      <CartProvider>
        <Navbar />
        {children}
        <CartDrawer />
        <NotificationPoller />
      </CartProvider>
    </WalletProvider>
  );
}
