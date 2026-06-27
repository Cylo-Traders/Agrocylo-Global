"use client";

import { cn } from "@/lib/utils";
import { CheckCheck, AlertCircle } from "lucide-react";
import { IoCopyOutline } from "react-icons/io5";
import { useEffect, useState } from "react";
import type { FC, ReactNode } from "react";

interface CopyButtonProps {
  text: string | undefined;
  children?: ReactNode;
  className?: string;
  iconClassName?: string;
}

type CopyState = "idle" | "copied" | "error";

const CopyButton: FC<CopyButtonProps> = ({
  text,
  children,
  iconClassName,
  className = "flex items-center gap-2",
}) => {
  const [copyState, setCopyState] = useState<CopyState>("idle");

  function handleFallbackCopy(text: string) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
      const successful = document.execCommand("copy");
      setCopyState(successful ? "copied" : "error");
    } catch {
      setCopyState("error");
    }
    document.body.removeChild(textarea);
  }

  function handleCopyClick() {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(() => setCopyState("copied"))
        .catch(() => handleFallbackCopy(text));
    } else {
      handleFallbackCopy(text);
    }
  }

  useEffect(() => {
    if (copyState === "idle") return;
    const id = setTimeout(() => {
      setCopyState("idle");
    }, 2000);
    return () => clearTimeout(id);
  }, [copyState]);

  const Icon = copyState === "copied" ? CheckCheck : copyState === "error" ? AlertCircle : IoCopyOutline;

  return (
    <button
      aria-label={copyState === "copied" ? "Copied!" : copyState === "error" ? "Copy failed" : "copy"}
      aria-live="polite"
      title={copyState === "copied" ? "Copied!" : copyState === "error" ? "Copy failed" : "click to copy"}
      className={cn(
        "cursor-pointer",
        copyState === "error" && "text-destructive",
        className,
      )}
      onClick={(e) => {
        e.preventDefault();
        handleCopyClick();
      }}
    >
      {children}
      <Icon aria-hidden className={cn("size-[14px]", iconClassName)} />
      {copyState === "error" && (
        <span role="alert" className="text-xs">Copy failed</span>
      )}
    </button>
  );
};

export default CopyButton;
export { CopyButton };
