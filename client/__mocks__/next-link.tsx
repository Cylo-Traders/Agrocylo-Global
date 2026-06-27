import React from "react";

const MockLink = ({
  children,
  href,
  ...props
}: {
  children?: React.ReactNode;
  href?: string;
  className?: string;
}) => React.createElement("a", { href, ...props }, children);

export default MockLink;
