"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  ShoppingBag,
  Package,
  BarChart3,
  ArrowLeft,
  ShieldCheck,
  Scale,
} from "lucide-react";
import { cn } from "@/lib/utils";

const sidebarLinks = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/orders", label: "Orders", icon: ShoppingBag },
  { href: "/admin/products", label: "Products", icon: Package },
  { href: "/admin/disputes", label: "Disputes", icon: Scale },
];

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="bg-sidebar flex min-h-dvh w-64 flex-col border-r">
      <div className="flex h-16 items-center gap-2 border-b px-6">
        <ShieldCheck className="text-primary size-5" />
        <span className="text-sm font-semibold">Admin Panel</span>
      </div>

      <nav className="flex-1 space-y-1 p-4">
        {sidebarLinks.map((link) => {
          const isActive =
            link.href === "/admin"
              ? pathname === "/admin"
              : pathname.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
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
          Back to Site
        </Link>
      </div>
    </aside>
  );
}
