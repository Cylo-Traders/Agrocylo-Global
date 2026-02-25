"use client";

import React from "react";
import { WalletProvider } from "../context/WalletContext";
import Navbar from "./Navbar";

export default function WalletProviderWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <WalletProvider>
      <Navbar />
      {children}
    </WalletProvider>
  );
}
