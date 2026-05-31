import { API_BASE_URL } from "@/lib/apiConfig";
import type { Order } from "@/types/order";

export interface PlatformStats {
  totalUsers: number;
  totalProducts: number;
  totalOrders: number;
  pendingEscrow: number;
  totalVolume: string;
  platformRevenue: string;
}

export interface RecentActivity {
  id: string;
  type: "order" | "user" | "product";
  description: string;
  timestamp: string;
  status?: string;
}

export interface AdminUser {
  wallet: string;
  displayName: string;
  role: "farmer" | "buyer";
  country: string;
  joined: string;
  orders: number;
  status: "active" | "suspended";
}

export interface AnalyticsData {
  series: Array<{
    month: string;
    gross: number;
    net: number;
  }>;
  ordersSeries: Array<{
    month: string;
    completed: number;
    pending: number;
    refunded: number;
  }>;
  monthlyVolume: string;
  conversionRate: string;
  newUsers: number;
  ordersToday: number;
}

export async function fetchPlatformStats(): Promise<PlatformStats> {
  const res = await fetch(`${API_BASE_URL}/admin/stats`, {
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch platform stats: ${res.status}`);
  }
  return res.json();
}

export async function fetchRecentActivity(): Promise<RecentActivity[]> {
  const res = await fetch(`${API_BASE_URL}/admin/activity`, {
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch recent activity: ${res.status}`);
  }
  return res.json();
}

export async function fetchAdminUsers(): Promise<AdminUser[]> {
  const res = await fetch(`${API_BASE_URL}/admin/users`, {
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch admin users: ${res.status}`);
  }
  return res.json();
}

export async function fetchAdminOrders(): Promise<Order[]> {
  const res = await fetch(`${API_BASE_URL}/admin/orders`, {
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch admin orders: ${res.status}`);
  }
  return res.json();
}

export async function fetchAnalyticsData(): Promise<AnalyticsData> {
  const res = await fetch(`${API_BASE_URL}/admin/analytics`, {
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch analytics data: ${res.status}`);
  }
  return res.json();
}
