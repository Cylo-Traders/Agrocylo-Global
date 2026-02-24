"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  isLoading?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-primary-600 text-white border-transparent hover:bg-primary-700 active:bg-primary-800 focus-visible:ring-primary-500",
  secondary:
    "bg-secondary-500 text-secondary-950 border-transparent hover:bg-secondary-600 active:bg-secondary-700 focus-visible:ring-secondary-500",
  outline:
    "bg-transparent text-foreground border-neutral-300 hover:bg-surface hover:border-neutral-400 focus-visible:ring-neutral-400 dark:border-neutral-600 dark:hover:bg-neutral-800",
  ghost:
    "bg-transparent text-foreground border-transparent hover:bg-surface focus-visible:ring-neutral-400",
  danger:
    "bg-error text-white border-transparent hover:opacity-90 active:opacity-80 focus-visible:ring-error",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-sm rounded-md min-h-8",
  md: "px-4 py-2 text-base rounded-lg min-h-10 sm:px-5 sm:py-2.5",
  lg: "px-6 py-3 text-lg rounded-lg min-h-12 sm:px-8 sm:py-3.5",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className = "",
      variant = "primary",
      size = "md",
      fullWidth = false,
      isLoading = false,
      disabled,
      children,
      ...props
    },
    ref
  ) => {
    return (
      <button
        ref={ref}
        type="button"
        disabled={disabled || isLoading}
        className={[
          "inline-flex items-center justify-center gap-2 font-medium border transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none",
          variantClasses[variant],
          sizeClasses[size],
          fullWidth ? "w-full" : "",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        {...props}
      >
        {isLoading ? (
          <>
            <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
            <span className="sr-only">Loading</span>
          </>
        ) : (
          children
        )}
      </button>
    );
  }
);

Button.displayName = "Button";
