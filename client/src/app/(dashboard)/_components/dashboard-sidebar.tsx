"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Package,
  ShoppingBag,
  TrendingUp,
  Settings,
  ArrowLeft,
  Shield,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useProfile } from "@/context/ProfileContext";

const sidebarLinks = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/products", label: "Products", icon: Package },
  { href: "/dashboard/orders", label: "Orders", icon: ShoppingBag },
  { href: "/dashboard/earnings", label: "Earnings", icon: TrendingUp },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

const adminLink = {
  href: "/admin",
  label: "Admin",
  icon: Shield,
};

export function DashboardSidebar() {
  const pathname = usePathname();
  const { isAdmin } = useProfile();
  const links = isAdmin ? [...sidebarLinks, adminLink] : sidebarLinks;

  return (
    <aside className="bg-sidebar flex min-h-dvh w-64 flex-col border-r">
      <div className="flex h-16 items-center gap-2 border-b px-6">
        <Link href="/" className="flex items-center gap-2">
          <Image
            src="/logo.svg"
            alt="AgroCylo"
            width={70}
            height={24}
            className="dark:hidden"
          />
          <Image
            src="/logo-light.svg"
            alt="AgroCylo"
            width={70}
            height={24}
            className="hidden dark:block"
          />
        </Link>
      </div>

      <nav className="flex-1 space-y-1 p-4">
        {links.map((link) => {
          const isActive =
            link.href === "/admin"
              ? pathname.startsWith("/admin")
              : pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
              )}
            >
              <link.icon className="size-4" />
              {link.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t p-4">
        <Link
          href="/"
          className="text-sidebar-foreground/70 hover:text-sidebar-foreground flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm transition-colors"
        >
          <ArrowLeft className="size-4" />
          Back to Marketplace
        </Link>
      </div>
    </aside>
  );
}
