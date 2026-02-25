"use client";

import { forwardRef, type HTMLAttributes } from "react";

export type ContainerSize = "sm" | "md" | "lg" | "full";

export interface ContainerProps extends HTMLAttributes<HTMLDivElement> {
  size?: ContainerSize;
}

const maxWidthClasses: Record<ContainerSize, string> = {
  sm: "max-w-screen-sm",
  md: "max-w-screen-md",
  lg: "max-w-screen-lg",
  full: "max-w-full",
};

export const Container = forwardRef<HTMLDivElement, ContainerProps>(
  ({ className = "", size = "lg", ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={[
          "mx-auto w-full px-4 sm:px-6 lg:px-8",
          maxWidthClasses[size],
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        {...props}
      />
    );
  }
);

Container.displayName = "Container";
