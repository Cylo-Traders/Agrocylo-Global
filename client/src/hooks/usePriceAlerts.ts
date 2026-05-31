"use client";

import { useCallback, useEffect, useState } from "react";
import type { PriceAlert, PriceAlertCreateInput } from "@/types/priceAlert";
import { priceAlertService } from "@/services/priceAlertService";

interface UsePriceAlertsState {
  alerts: PriceAlert[];
  loading: boolean;
  error: string | null;
}

export function usePriceAlerts(
  filters?: {
    status?: "active" | "inactive";
    category?: string;
  }
) {
  const [state, setState] = useState<UsePriceAlertsState>({
    alerts: [],
    loading: true,
    error: null,
  });

  const fetchAlerts = useCallback(async () => {
    try {
      setState((prev) => ({ ...prev, loading: true, error: null }));
      const alerts = await priceAlertService.getAlerts(filters);
      setState((prev) => ({ ...prev, alerts, loading: false }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error:
          error instanceof Error ? error.message : "Failed to fetch alerts",
        loading: false,
      }));
    }
  }, [filters]);

  useEffect(() => {
    void fetchAlerts();
  }, [fetchAlerts]);

  const createAlert = useCallback(
    async (alert: PriceAlertCreateInput) => {
      try {
        const newAlert = await priceAlertService.createAlert(alert);
        setState((prev) => ({
          ...prev,
          alerts: [...prev.alerts, newAlert],
        }));
        return newAlert;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to create alert";
        setState((prev) => ({ ...prev, error: message }));
        throw error;
      }
    },
    []
  );

  const updateAlert = useCallback(
    async (id: string, updates: Partial<PriceAlertCreateInput>) => {
      try {
        const updated = await priceAlertService.updateAlert(id, updates);
        setState((prev) => ({
          ...prev,
          alerts: prev.alerts.map((a) => (a.id === id ? updated : a)),
        }));
        return updated;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to update alert";
        setState((prev) => ({ ...prev, error: message }));
        throw error;
      }
    },
    []
  );

  const deleteAlert = useCallback(async (id: string) => {
    try {
      await priceAlertService.deleteAlert(id);
      setState((prev) => ({
        ...prev,
        alerts: prev.alerts.filter((a) => a.id !== id),
      }));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to delete alert";
      setState((prev) => ({ ...prev, error: message }));
      throw error;
    }
  }, []);

  const toggleAlert = useCallback(async (id: string, enabled: boolean) => {
    try {
      const updated = await priceAlertService.toggleAlert(id, enabled);
      setState((prev) => ({
        ...prev,
        alerts: prev.alerts.map((a) => (a.id === id ? updated : a)),
      }));
      return updated;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to toggle alert";
      setState((prev) => ({ ...prev, error: message }));
      throw error;
    }
  }, []);

  return {
    ...state,
    fetchAlerts,
    createAlert,
    updateAlert,
    deleteAlert,
    toggleAlert,
  };
}
