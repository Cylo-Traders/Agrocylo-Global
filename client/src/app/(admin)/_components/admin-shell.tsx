"use client";

import type { ReactNode } from "react";
import AdminGuard from "@/components/AdminGuard";
import { useProfile } from "@/context/ProfileContext";
import { AdminSidebar } from "./admin-sidebar";
import { AdminHeader } from "./admin-header";
import { DashboardFooter } from "@/components/shared/dashboard-footer";

export function AdminShell({ children }: { children: ReactNode }) {
  const { isLoaded, isAdmin } = useProfile();

  if (!isLoaded || !isAdmin) {
    return (
      <div className="flex min-h-screen flex-col">
        <main className="flex flex-1 flex-col overflow-hidden">
          <AdminGuard>{children}</AdminGuard>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen">
      <div className="hidden lg:block">
        <AdminSidebar />
      </div>
      <div className="flex flex-1 flex-col overflow-hidden">
        <AdminHeader />
        <main className="flex-1 overflow-y-auto p-6" data-lenis-prevent>
          <AdminGuard>{children}</AdminGuard>
        </main>
        <DashboardFooter />
      </div>
    </div>
  );
}
