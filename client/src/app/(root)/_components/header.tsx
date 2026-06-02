"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Menu, ShoppingBag } from "lucide-react";

import Wrapper from "@/components/shared/wrapper";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { Separator } from "@/components/ui/separator";
import ConnectWallet from "@/components/shared/connect-wallet";
import { siteConfig } from "@/config/site.config";
import { useCart } from "@/context/CartContext";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const navItems = [
  { title: "Home", href: "/" },
  { title: "Marketplace", href: "/market" },
  { title: "Map", href: "/map" },
  { title: "Orders", href: "/orders" },
  { title: "About", href: "/about" },
];

export default function Header() {
  const { itemCount, setDrawerOpen } = useCart();
  const pathname = usePathname();

  return (
    <header className="fixed top-0 left-0 z-50 flex h-16 w-full flex-col justify-end border-b border-border/60 bg-background/80 backdrop-blur-3xl transition-colors duration-300 ease-in-out md:h-28">
      <Wrapper
        max2
        className="mt-auto flex items-center justify-between gap-3 pb-2 md:pb-4"
      >
        <Link
          href="/"
          className="-ml-1 flex w-fit items-center gap-2 md:max-w-[180px] lg:max-w-[240px]"
        >
          <Image
            src="/logo.svg"
            alt={siteConfig.title}
            height={49}
            width={131}
            priority
            quality={100}
            className="!h-[34px] !w-[100px] object-contain dark:hidden sm:!h-[49px] sm:!w-[131px]"
          />
          <Image
            src="/logo-light.svg"
            alt={siteConfig.title}
            height={49}
            width={131}
            priority
            quality={100}
            className="!h-[34px] !w-[100px] hidden object-contain dark:block sm:!h-[49px] sm:!w-[131px]"
          />
        </Link>

        <ul className="hidden flex-1 items-center justify-center gap-7 md:flex lg:gap-8 xl:gap-10">
          {navItems.map((item) => (
            <li key={item.title}>
              <Link
                href={item.href}
                className={cn(
                  "text-sm font-normal transition-colors hover:text-primary lg:text-lg",
                  pathname === item.href && "text-primary",
                )}
              >
                {item.title}
              </Link>
            </li>
          ))}
        </ul>

        <div className="flex items-center justify-end gap-1">
          <div className="hidden items-center gap-1 md:flex lg:max-w-[280px]">
            <ThemeToggle />
            <Separator orientation="vertical" className="mx-1 !h-5" />
            <ConnectWallet />
            <Separator orientation="vertical" className="mx-1 !h-5" />
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open cart"
            className="relative size-11"
          >
            <ShoppingBag className="size-5" />
            {itemCount > 0 && (
              <span className="absolute -top-1 -right-1 grid size-4 place-content-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                {itemCount}
              </span>
            )}
          </Button>
          <Sheet>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-11 md:hidden"
                aria-label="Open navigation menu"
              >
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[min(22rem,100vw)] px-0 py-0">
              <div className="flex h-full flex-col">
                <SheetHeader className="border-b px-6 pt-6 pb-4">
                  <SheetTitle className="text-left text-lg">Menu</SheetTitle>
                  <SheetDescription className="text-left">
                    Navigate the marketplace and manage your account.
                  </SheetDescription>
                </SheetHeader>

                <div className="flex-1 space-y-2 px-4 py-4">
                  {navItems.map((item) => {
                    const isActive =
                      item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

                    return (
                      <Link
                        key={item.title}
                        href={item.href}
                        className={cn(
                          "flex min-h-11 items-center rounded-2xl px-4 py-3 text-sm font-medium transition-colors",
                          isActive
                            ? "bg-primary text-primary-foreground"
                            : "hover:bg-accent hover:text-accent-foreground",
                        )}
                      >
                        {item.title}
                      </Link>
                    );
                  })}
                </div>

                <div className="border-t px-4 py-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
                  <div className="flex items-center gap-2">
                    <ThemeToggle />
                    <div className="flex-1">
                      <ConnectWallet />
                    </div>
                  </div>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </Wrapper>
    </header>
  );
}
