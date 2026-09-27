"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import WalletConnect from "@/components/WalletConnect";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { useTheme } from "@/context/ThemeContext";
import { useI18n } from "@/context/I18nContext";

const MAIN_CLIENT_URL = process.env.NEXT_PUBLIC_MAIN_CLIENT_URL ?? "http://localhost:3000";

const PRIMARY_LINKS = [
  { href: "/marketplace", key: "navigation.marketplace", fallback: "Marketplace" },
  { href: "/campaigns", key: "navigation.campaigns", fallback: "Campaigns" },
  { href: "/orders", key: "navigation.orders", fallback: "Orders" },
  { href: "/farmer-dashboard", key: "navigation.farmerDashboard", fallback: "Farmer" },
  { href: "/dashboard", key: "navigation.dashboard", fallback: "Dashboard" },
] as const;

const linkClasses =
  "block rounded-lg px-3 py-2 text-muted transition-colors hover:bg-background hover:text-foreground";
const activeLinkClasses = "bg-background font-medium text-foreground";

export default function NavBar() {
  const { resolvedTheme, toggleTheme } = useTheme();
  const { t } = useI18n();
  const pathname = usePathname();

  const [isOpen, setIsOpen] = useState(false);
  const menuId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const isActive = useCallback(
    (href: string) => pathname === href || pathname?.startsWith(`${href}/`),
    [pathname],
  );

  // Activating a destination closes the menu, because a navigation renders a
  // new page and a panel left open over it is both confusing and unreachable
  // for the next focus stop.
  const closeMenu = useCallback(() => setIsOpen(false), []);

  // Escape closes the menu and returns focus to the trigger so keyboard users
  // are never stranded inside a panel that is no longer visible.
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setIsOpen(false);
      toggleRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  const themeLabel =
    resolvedTheme === "dark"
      ? t("navigation.switchToLight", "Switch to light mode")
      : t("navigation.switchToDark", "Switch to dark mode");

  const themeToggle = (
    <button
      type="button"
      onClick={toggleTheme}
      className="text-muted hover:text-foreground border border-border px-2.5 py-1.5 rounded-lg text-sm transition-colors"
      aria-label={themeLabel}
      title={themeLabel}
    >
      {resolvedTheme === "dark" ? "☀️" : "🌙"}
    </button>
  );

  return (
    <nav className="border-b border-border bg-surface sticky top-0 z-10" aria-label={t("navigation.main", "Main navigation")}>
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Link
            href="/home"
            className="font-bold text-base sm:text-lg text-primary-600 hover:text-primary-700 truncate"
            aria-label={t("navigation.home", "AgroProduction home")}
          >
            <span aria-hidden="true">🌾 </span>
            <span className="hidden sm:inline">AgroProduction</span>
          </Link>
          <a
            href={MAIN_CLIENT_URL}
            className="hidden sm:inline-flex items-center text-xs text-muted hover:text-foreground border border-border px-2 py-1 rounded transition-colors whitespace-nowrap"
            aria-label={t("navigation.backToMain", "Back to Agrocylo main app")}
          >
            ← {t("navigation.backToMain", "Back to Agrocylo")}
          </a>
        </div>

        {/* Desktop: the full row. `md` is the same breakpoint the panel uses, so
            there is never a frame where both layouts are visible. */}
        <div className="hidden md:flex items-center gap-3 text-sm">
          {PRIMARY_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`${linkClasses} ${isActive(link.href) ? activeLinkClasses : ""}`}
              aria-current={isActive(link.href) ? "page" : undefined}
            >
              {t(link.key, link.fallback)}
            </Link>
          ))}
          {themeToggle}
          <LanguageSwitcher />
          <WalletConnect />
        </div>

        {/* Mobile: a single trigger that always fits 320px. */}
        <div className="md:hidden flex items-center gap-1.5">
          {themeToggle}
          <WalletConnect />
          <button
            type="button"
            ref={toggleRef}
            onClick={() => setIsOpen((open) => !open)}
            aria-expanded={isOpen}
            aria-controls={menuId}
            aria-label={
              isOpen
                ? t("navigation.closeMenu", "Close navigation menu")
                : t("navigation.openMenu", "Open navigation menu")
            }
            title={
              isOpen
                ? t("navigation.closeMenu", "Close navigation menu")
                : t("navigation.openMenu", "Open navigation menu")
            }
            className="inline-flex items-center justify-center h-9 w-9 rounded-lg border border-border text-muted hover:text-foreground transition-colors"
          >
            <span aria-hidden="true">{isOpen ? "✕" : "☰"}</span>
          </button>
        </div>
      </div>

      <div
        id={menuId}
        ref={panelRef}
        hidden={!isOpen}
        className="md:hidden border-t border-border bg-surface"
      >
        <div className="max-w-5xl mx-auto px-4 py-3 flex flex-col gap-1 text-sm">
          {PRIMARY_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`${linkClasses} ${isActive(link.href) ? activeLinkClasses : ""}`}
              aria-current={isActive(link.href) ? "page" : undefined}
              onClick={closeMenu}
            >
              {t(link.key, link.fallback)}
            </Link>
          ))}
          <a
            href={MAIN_CLIENT_URL}
            className="block rounded-lg px-3 py-2 text-muted transition-colors hover:bg-background hover:text-foreground border border-border sm:hidden"
            aria-label={t("navigation.backToMain", "Back to Agrocylo main app")}
            onClick={closeMenu}
          >
            ← {t("navigation.backToMain", "Back to Agrocylo")}
          </a>
          <div className="pt-2 sm:hidden">
            <LanguageSwitcher />
          </div>
        </div>
      </div>
    </nav>
  );
}
