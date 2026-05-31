"use client";

import { AlertCircle } from "lucide-react";

interface FormErrorProps {
  message?: string | null;
  errors?: string[];
}

export function FormError({ message, errors }: FormErrorProps) {
  if (!message && (!errors || errors.length === 0)) return null;

  const items = errors && errors.length > 0 ? errors : message ? [message] : [];

  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        {items.length === 1 ? (
          <p>{items[0]}</p>
        ) : (
          <ul className="list-inside list-disc space-y-1">
            {items.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
