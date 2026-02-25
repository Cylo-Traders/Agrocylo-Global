"use client";

import React, { createElement, type HTMLAttributes } from "react";

export type TextVariant =
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "body"
  | "bodySmall"
  | "caption"
  | "label";

export interface TextProps extends HTMLAttributes<HTMLElement> {
  variant?: TextVariant;
  as?: keyof React.JSX.IntrinsicElements;
  muted?: boolean;
}

const variantMap: Record<
  TextVariant,
  { tag: keyof React.JSX.IntrinsicElements; className: string }
> = {
  h1: {
    tag: "h1",
    className:
      "text-3xl font-bold tracking-tight text-foreground sm:text-4xl md:text-5xl",
  },
  h2: {
    tag: "h2",
    className:
      "text-2xl font-bold tracking-tight text-foreground sm:text-3xl",
  },
  h3: {
    tag: "h3",
    className: "text-xl font-semibold text-foreground sm:text-2xl",
  },
  h4: {
    tag: "h4",
    className: "text-lg font-semibold text-foreground sm:text-xl",
  },
  body: {
    tag: "p",
    className: "text-base leading-normal text-foreground sm:text-lg",
  },
  bodySmall: {
    tag: "p",
    className: "text-sm leading-normal text-foreground sm:text-base",
  },
  caption: {
    tag: "span",
    className: "text-xs text-muted sm:text-sm",
  },
  label: {
    tag: "span",
    className: "text-sm font-medium text-foreground",
  },
};

export function Text({
  variant = "body",
  as,
  muted = false,
  className = "",
  ...props
}: TextProps) {
  const { tag, className: variantClass } = variantMap[variant];
  const Component = as ?? tag;
  return createElement(Component, {
    className: [
      variantClass,
      muted ? "text-muted" : "",
      className,
    ]
      .filter(Boolean)
      .join(" "),
    ...props,
  });
}
