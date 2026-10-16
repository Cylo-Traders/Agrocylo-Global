"use client";

import { useEffect, useState } from "react";
import { registerProductionServiceWorker } from "@/lib/pwaSetup";

const DISMISSED_KEY = "ap_pwa_install_dismissed";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function PwaSetup() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(true);
  const [standalone, setStandalone] = useState(false);

  useEffect(() => {
    void registerProductionServiceWorker();
    try {
      setDismissed(localStorage.getItem(DISMISSED_KEY) === "yes");
    } catch {
      setDismissed(true);
    }
    setStandalone(window.matchMedia?.("(display-mode: standalone)").matches ?? false);
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPromptEvent);
    };
    const onInstalled = () => setPrompt(null);
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function install() {
    if (!prompt) return;
    await prompt.prompt();
    const result = await prompt.userChoice;
    setPrompt(null);
    if (result.outcome === "dismissed") dismiss();
  }

  function dismiss() {
    try {
      localStorage.setItem(DISMISSED_KEY, "yes");
    } catch {
      // Keep the prompt dismissed for this page view if storage is unavailable.
    }
    setDismissed(true);
  }

  if (!prompt || dismissed || standalone) return null;

  return (
    <aside aria-label="Install Agro Production" className="fixed bottom-4 right-4 z-40 flex items-center gap-3 rounded-xl border border-border bg-background p-3 shadow-lg">
      <span className="text-sm">Install Agro Production for offline access</span>
      <button type="button" onClick={install} className="rounded bg-primary-600 px-3 py-2 text-sm text-white">Install</button>
      <button type="button" onClick={dismiss} aria-label="Dismiss install prompt" className="rounded border border-border px-3 py-2 text-sm">Dismiss</button>
    </aside>
  );
}
