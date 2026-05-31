"use client";

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

export function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setShowPrompt(true);
    };

    window.addEventListener('beforeinstallprompt', handler);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setDeferredPrompt(null);
        setShowPrompt(false);
      }
    }
  };

  if (!showPrompt) return null;

  return (
    <div className="fixed bottom-4 right-4 bg-white dark:bg-zinc-800 p-4 rounded shadow-lg z-50 flex items-center space-x-4 border border-zinc-200 dark:border-zinc-700">
      <div>
        <p className="font-semibold text-zinc-900 dark:text-zinc-100">Install App</p>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Install our app for offline support.</p>
      </div>
      <Button onClick={handleInstallClick} size="sm">Install</Button>
    </div>
  );
}
