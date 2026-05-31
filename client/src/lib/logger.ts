"use client";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  id: string;
  timestamp: number;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  stack?: string;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const STORAGE_KEY = "agrocylo_logs";
const MAX_STORED_LOGS = 500;
const BATCH_SIZE = 10;
const FLUSH_INTERVAL_MS = 30_000;

class Logger {
  private minLevel: LogLevel = "debug";
  private logs: LogEntry[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.loadFromStorage();
    this.startAutoFlush();
  }

  setMinLevel(level: LogLevel) {
    this.minLevel = level;
  }

  debug(message: string, context?: Record<string, unknown>) {
    this.log("debug", message, context);
  }

  info(message: string, context?: Record<string, unknown>) {
    this.log("info", message, context);
  }

  warn(message: string, context?: Record<string, unknown>) {
    this.log("warn", message, context);
  }

  error(message: string, context?: Record<string, unknown>) {
    this.log("error", message, context);
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>) {
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[this.minLevel]) return;

    const entry: LogEntry = {
      id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      timestamp: Date.now(),
      level,
      message,
      context,
      stack: level === "error" ? new Error().stack : undefined,
    };

    this.logs.push(entry);
    this.persist();

    if (typeof console !== "undefined") {
      const fn = console[level] ?? console.log;
      fn(`[${level.toUpperCase()}] ${message}`, context ?? "");
    }

    if (level === "error" && this.logs.filter((l) => l.level === "error").length >= BATCH_SIZE) {
      this.flush();
    }
  }

  private persist() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as LogEntry[];
      const merged = [...stored, ...this.logs];
      const trimmed = merged.slice(-MAX_STORED_LOGS);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
      this.logs = [];
    } catch {
      if (this.logs.length > MAX_STORED_LOGS) {
        this.logs = this.logs.slice(-MAX_STORED_LOGS);
      }
    }
  }

  private loadFromStorage() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        this.logs = JSON.parse(stored) as LogEntry[];
      }
    } catch {
      this.logs = [];
    }
  }

  getStoredLogs(): LogEntry[] {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as LogEntry[];
    } catch {
      return [];
    }
  }

  clearLogs() {
    this.logs = [];
    localStorage.removeItem(STORAGE_KEY);
  }

  private startAutoFlush() {
    if (typeof window === "undefined") return;
    this.flushTimer = setInterval(() => {
      const errors = this.getStoredLogs().filter((l) => l.level === "error");
      if (errors.length > 0) {
        this.sendToBackend(errors);
      }
    }, FLUSH_INTERVAL_MS);
  }

  private async sendToBackend(entries: LogEntry[]) {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000";
      await fetch(`${apiUrl}/api/logs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logs: entries }),
        keepalive: true,
      });
    } catch {
      console.warn("[Logger] Failed to flush logs to backend");
    }
  }

  async flush() {
    const errors = this.getStoredLogs().filter((l) => l.level === "error");
    if (errors.length > 0) {
      await this.sendToBackend(errors);
    }
  }

  destroy() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }
}

export const logger = typeof window !== "undefined" ? new Logger() : (null as unknown as Logger);
