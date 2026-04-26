'use client';

import { ReactNode } from 'react';
import {  mapBlockchainError } from './errorHandler';

export interface ErrorDisplayProps {
  error: unknown;
  details?: string;
  children?: ReactNode;
}

export function ErrorDisplay({ error, details, children }: ErrorDisplayProps) {
  if (!error) return null;

  const mapped = mapBlockchainError(error);

  return (
    <div className="border border-red-400 rounded-lg p-4 bg-red-50 text-red-900">
      <h2 className="text-lg font-bold mb-2">{mapped.title}</h2>

      <p className="mb-3">{mapped.message}</p>

      {mapped.action && (
        <p className="mb-3 font-semibold">
          Action: {mapped.action}
        </p>
      )}

      {details && (
        <pre className="m-0 whitespace-pre-wrap text-xs bg-red-100 p-2 rounded">
          {details}
        </pre>
      )}

      {children}
    </div>
  );
}
