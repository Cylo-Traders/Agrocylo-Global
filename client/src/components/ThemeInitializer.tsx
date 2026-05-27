"use client";

import { useEffect } from "react";
import { initTheme } from "@/lib/theme";
import { initErrorTracking } from "@/lib/errorTracking";
import { trackPageView } from "@/lib/analytics";
import { usePathname } from "next/navigation";

export default function ThemeInitializer() {
  const pathname = usePathname();

  useEffect(() => {
    initTheme();
    initErrorTracking();
  }, []);

  useEffect(() => {
    trackPageView(pathname);
  }, [pathname]);

  return null;
}
