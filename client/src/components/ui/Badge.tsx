"use client";

import { type HTMLAttributes } from "react";

export type BadgeVariant = "default" | "primary" | "secondary" | "success" | "warning" | "error" | "outline";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const variantClasses: Record<BadgeVariant, string> = {
  default: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
  primary: "bg-primary-100 text-primary-800 dark:bg-primary-900/40 dark:text-primary-200",
  secondary: "bg-secondary-100 text-secondary-800 dark:bg-secondary-900/40 dark:text-secondary-200",
  success: "bg-primary-100 text-primary-800 dark:bg-primary-900/40 dark:text-primary-200",
  warning: "bg-secondary-100 text-secondary-800 dark:bg-secondary-900/40 dark:text-secondary-200",
  error: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  outline: "bg-transparent border border-border text-foreground",
};

export function Badge({
  className = "",
  variant = "default",
  ...props
}: BadgeProps) {
  return (
    <span
      className={[
        "inline-flex items-center rounded-md px-2.5 py-0.5 text-xs font-medium sm:text-sm",
        variantClasses[variant],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    />
  );
}
