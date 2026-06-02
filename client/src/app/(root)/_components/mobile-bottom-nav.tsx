"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Store, MapPinned, ClipboardList, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

const bottomNavItems = [
  { href: "/", label: "Home", icon: Home },
  { href: "/market", label: "Market", icon: Store },
  { href: "/map", label: "Map", icon: MapPinned },
  { href: "/orders", label: "Orders", icon: ClipboardList },
  { href: "/about", label: "More", icon: MoreHorizontal },
];

export function MobileBottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Mobile navigation"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-background/95 backdrop-blur-xl md:hidden"
    >
      <div className="mx-auto grid max-w-[1240px] grid-cols-5 gap-1 px-2 pt-2 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
        {bottomNavItems.map((item) => {
          const isActive =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex min-h-11 flex-col items-center justify-center gap-1 rounded-2xl px-1 py-2 text-[11px] font-medium transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <item.icon className="size-4" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
