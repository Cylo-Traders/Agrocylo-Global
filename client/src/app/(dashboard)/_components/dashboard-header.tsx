"use client";

import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import ConnectWallet from "@/components/shared/connect-wallet";
import { DashboardSidebar } from "./dashboard-sidebar";

export function DashboardHeader() {
  return (
    <header className="bg-background flex h-16 items-center gap-3 border-b px-4 sm:px-6">
      <Sheet>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="size-11 lg:hidden">
            <Menu className="size-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-[min(18rem,100vw)] p-0">
          <DashboardSidebar />
        </SheetContent>
      </Sheet>

      <div className="flex-1" />
      <ThemeToggle />
      <ConnectWallet />
    </header>
  );
}
