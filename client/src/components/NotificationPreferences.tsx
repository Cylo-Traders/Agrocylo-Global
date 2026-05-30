"use client";

/**
 * NotificationPreferences — per-type toggles, delivery methods, quiet hours.
 * Loads from the backend; localStorage is used only as an offline read fallback.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Mail, Monitor, Volume2, VolumeX } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useWallet } from "@/hooks/useWallet";
import {
  DEFAULT_NOTIFICATION_PREFS,
  getNotificationPreferences,
  updateNotificationPreferences,
  type NotificationPrefs,
} from "@/services/notification/api";

const STORAGE_KEY = "agrocylo:notification-prefs";

function loadOfflinePrefs(): NotificationPrefs | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return { ...DEFAULT_NOTIFICATION_PREFS, ...JSON.parse(raw) } as NotificationPrefs;
  } catch {
    return null;
  }
}

function saveOfflinePrefs(prefs: NotificationPrefs) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

function Toggle({
  checked,
  onChange,
  id,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  id: string;
  disabled?: boolean;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? "bg-primary" : "bg-muted"
      }`}
    >
      <span
        className={`inline-block size-3.5 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function Row({
  label,
  description,
  checked,
  onChange,
  id,
  disabled,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  id: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div>
        <label htmlFor={id} className="cursor-pointer text-sm font-medium">
          {label}
        </label>
        {description && (
          <p className="text-muted-foreground text-xs">{description}</p>
        )}
      </div>
      <Toggle id={id} checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}

interface NotificationPreferencesProps {
  embedded?: boolean;
}

export function NotificationPreferences({ embedded = false }: NotificationPreferencesProps) {
  const { address, connected } = useWallet();
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_NOTIFICATION_PREFS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  useEffect(() => {
    if (!connected || !address) {
      setPrefs(loadOfflinePrefs() ?? DEFAULT_NOTIFICATION_PREFS);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const serverPrefs = await getNotificationPreferences(address);
        if (cancelled) return;
        setPrefs(serverPrefs);
        saveOfflinePrefs(serverPrefs);
      } catch {
        if (cancelled) return;
        const offline = loadOfflinePrefs();
        if (offline) {
          setPrefs(offline);
          setError("Could not reach the server. Showing offline preferences.");
        } else {
          setPrefs(DEFAULT_NOTIFICATION_PREFS);
          setError("Failed to load notification preferences.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [address, connected]);

  const persist = useCallback(
    async (updated: NotificationPrefs) => {
      const previous = prefsRef.current;
      setPrefs(updated);
      setError(null);
      saveOfflinePrefs(updated);

      if (!connected || !address) return;

      setSaving(true);
      try {
        const saved = await updateNotificationPreferences(address, updated);
        setPrefs(saved);
        saveOfflinePrefs(saved);
      } catch (err) {
        setPrefs(previous);
        saveOfflinePrefs(previous);
        setError(
          err instanceof Error ? err.message : "Failed to save notification preferences.",
        );
      } finally {
        setSaving(false);
      }
    },
    [address, connected],
  );

  function setType(key: keyof NotificationPrefs["types"], value: boolean) {
    void persist({ ...prefs, types: { ...prefs.types, [key]: value } });
  }

  function setDelivery(method: keyof NotificationPrefs["delivery"], value: boolean) {
    void persist({ ...prefs, delivery: { ...prefs.delivery, [method]: value } });
  }

  const disabled = loading || saving;

  const content = (
    <>
      {error && (
        <p className="text-destructive mb-4 text-sm" role="alert">
          {error}
        </p>
      )}

      <div>
        <p className="text-muted-foreground mb-3 text-xs font-semibold uppercase tracking-wide">
          Notification types
        </p>
        <div className="divide-y">
          <Row id="pref-orders" label="Order updates" description="Status changes for your orders" checked={prefs.types.orders} onChange={(v) => setType("orders", v)} disabled={disabled} />
          <Row id="pref-disputes" label="Disputes" description="New and resolved disputes" checked={prefs.types.disputes} onChange={(v) => setType("disputes", v)} disabled={disabled} />
          <Row id="pref-price" label="Price alerts" description="When commodities hit your targets" checked={prefs.types.priceAlerts} onChange={(v) => setType("priceAlerts", v)} disabled={disabled} />
          <Row id="pref-system" label="System announcements" checked={prefs.types.system} onChange={(v) => setType("system", v)} disabled={disabled} />
          <Row id="pref-demand" label="Demand signals" description="New buyer intents in your area" checked={prefs.types.demandSignals} onChange={(v) => setType("demandSignals", v)} disabled={disabled} />
        </div>
      </div>

      <Separator />

      <div>
        <p className="text-muted-foreground mb-3 text-xs font-semibold uppercase tracking-wide">
          Delivery methods
        </p>
        <div className="divide-y">
          <Row id="del-toast" label="In-app toast" description="Instant notifications in the UI" checked={prefs.delivery.toast} onChange={(v) => setDelivery("toast", v)} disabled={disabled} />
          <Row id="del-email" label="Email" description="Notifications sent to your email" checked={prefs.delivery.email} onChange={(v) => setDelivery("email", v)} disabled={disabled} />
          <Row id="del-push" label="Browser push" description="Browser push notifications" checked={prefs.delivery.push} onChange={(v) => setDelivery("push", v)} disabled={disabled} />
        </div>
      </div>

      <Separator />

      <div>
        <p className="text-muted-foreground mb-3 text-xs font-semibold uppercase tracking-wide">
          Sound & quiet hours
        </p>
        <Row
          id="pref-sound"
          label="Notification sounds"
          checked={prefs.sound}
          onChange={(v) => void persist({ ...prefs, sound: v })}
          disabled={disabled}
        />
        <Row
          id="pref-quiet"
          label="Quiet hours"
          description="Suppress notifications during set hours"
          checked={prefs.quietHoursEnabled}
          onChange={(v) => void persist({ ...prefs, quietHoursEnabled: v })}
          disabled={disabled}
        />
        {prefs.quietHoursEnabled && (
          <div className="mt-3 flex items-center gap-3 text-sm">
            <div className="flex items-center gap-2">
              <label htmlFor="quiet-start" className="text-muted-foreground text-xs">
                From
              </label>
              <input
                id="quiet-start"
                type="time"
                value={prefs.quietStart}
                disabled={disabled}
                onChange={(e) => void persist({ ...prefs, quietStart: e.target.value })}
                className="border-input rounded-md border bg-transparent px-2 py-1 text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="quiet-end" className="text-muted-foreground text-xs">
                To
              </label>
              <input
                id="quiet-end"
                type="time"
                value={prefs.quietEnd}
                disabled={disabled}
                onChange={(e) => void persist({ ...prefs, quietEnd: e.target.value })}
                className="border-input rounded-md border bg-transparent px-2 py-1 text-sm"
              />
            </div>
          </div>
        )}
      </div>
    </>
  );

  if (embedded) {
    return <div className="space-y-6">{content}</div>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Bell className="text-primary size-5" />
          Notification Preferences
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">{content}</CardContent>
    </Card>
  );
}
