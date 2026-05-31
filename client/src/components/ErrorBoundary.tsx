"use client";

import React, { Component, ErrorInfo, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { classifyError } from "@/components/errorHandler";
import { logger } from "@/lib/logger";

interface Props {
  children?: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const info = classifyError(error);
    try {
      logger?.error?.(error.message, {
        componentStack: errorInfo.componentStack,
        errorKind: info.kind,
        ...(process.env.NODE_ENV === "development" && { stack: error.stack }),
      });
    } catch {
      console.error("Uncaught error:", error, errorInfo);
    }
    this.props.onError?.(error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.href = "/";
  };

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const info = this.state.error
        ? classifyError(this.state.error)
        : null;

      return (
        <div className="flex min-h-screen flex-col items-center justify-center p-4 text-center">
          <div className="max-w-md space-y-4 rounded-xl border bg-card p-6 shadow-sm">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>

            <h2 className="text-xl font-bold">
              {info?.title ?? "Something went wrong"}
            </h2>

            <p className="text-sm text-muted-foreground">
              {info?.action ??
                "An unexpected error occurred. Please try again or contact support if the issue persists."}
            </p>

            {this.state.error && process.env.NODE_ENV === "development" && (
              <pre className="mt-4 max-h-32 overflow-auto rounded bg-muted p-2 text-left text-xs text-muted-foreground">
                {this.state.error.message}
                {this.state.error.stack && `\n\n${this.state.error.stack}`}
              </pre>
            )}

            <div className="pt-4 space-x-2">
              <Button onClick={this.handleRetry} variant="outline">
                Retry Page
              </Button>
              <Button onClick={this.handleReset}>
                Go Home
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
