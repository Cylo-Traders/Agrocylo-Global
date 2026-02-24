"use client";

import { forwardRef, type HTMLAttributes } from "react";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: "elevated" | "outlined" | "filled";
  padding?: "none" | "sm" | "md" | "lg";
}

const paddingClasses = {
  none: "",
  sm: "p-4 sm:p-5",
  md: "p-5 sm:p-6 md:p-8",
  lg: "p-6 sm:p-8 md:p-10",
};

const variantClasses = {
  elevated:
    "bg-surface-elevated shadow-md rounded-xl border border-border",
  outlined:
    "bg-transparent border border-border rounded-xl",
  filled:
    "bg-surface rounded-xl border border-border",
};

export const Card = forwardRef<HTMLDivElement, CardProps>(
  (
    {
      className = "",
      variant = "elevated",
      padding = "md",
      ...props
    },
    ref
  ) => {
    return (
      <div
        ref={ref}
        className={[
          variantClasses[variant],
          paddingClasses[padding],
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        {...props}
      />
    );
  }
);

Card.displayName = "Card";

export const CardHeader = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className = "", ...props }, ref) => (
  <div ref={ref} className={`mb-4 sm:mb-5 ${className}`} {...props} />
));

CardHeader.displayName = "CardHeader";

export const CardTitle = forwardRef<
  HTMLHeadingElement,
  HTMLAttributes<HTMLHeadingElement>
>(({ className = "", ...props }, ref) => (
  <h3
    ref={ref}
    className={`text-lg font-semibold text-foreground sm:text-xl ${className}`}
    {...props}
  />
));

CardTitle.displayName = "CardTitle";

export const CardContent = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className = "", ...props }, ref) => (
  <div ref={ref} className={`text-muted text-sm sm:text-base ${className}`} {...props} />
));

CardContent.displayName = "CardContent";

export const CardFooter = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className = "", ...props }, ref) => (
  <div
    ref={ref}
    className={`mt-4 flex flex-wrap items-center gap-3 sm:mt-5 ${className}`}
    {...props}
  />
));

CardFooter.displayName = "CardFooter";
