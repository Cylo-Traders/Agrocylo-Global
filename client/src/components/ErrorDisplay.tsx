'use client';

import { ReactNode } from 'react';
import { mapBlockchainError, classifyError } from './errorHandler';
import type { ErrorInfo } from './errorHandler';

export interface ErrorDisplayProps {
  error: unknown;
  details?: string;
  children?: ReactNode;
  variant?: 'blockchain' | 'generic';
  showIcon?: boolean;
}

const icons: Record<ErrorInfo['kind'], string> = {
  network: '🌐',
  authentication: '🔑',
  validation: '📝',
  blockchain: '⛓️',
  wallet: '💳',
  unknown: '❌',
};

export function ErrorDisplay({
  error,
  details,
  children,
  variant = 'blockchain',
  showIcon = true,
}: ErrorDisplayProps) {
  if (!error) return null;

  const mapped = variant === 'blockchain'
    ? mapBlockchainError(error)
    : classifyError(error);

  const icon = !showIcon ? null : variant === 'generic'
    ? icons[(mapped as ErrorInfo).kind] ?? '❌'
    : null;

  return (
    <div className="border border-red-400 rounded-lg p-4 bg-red-50 text-red-900 dark:bg-red-950 dark:border-red-800 dark:text-red-200">
      <div className="flex items-start gap-3">
        {icon && (
          <span className="text-xl mt-0.5" role="img" aria-hidden="true">
            {icon}
          </span>
        )}
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-bold mb-2">{mapped.title}</h2>
          <p className="mb-3">{mapped.message}</p>
          <p className="mb-3 font-semibold text-sm">
            {mapped.action}
          </p>
          {'documentationUrl' in mapped && mapped.documentationUrl && (
            <a
              href={mapped.documentationUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm underline hover:no-underline"
            >
              Learn more →
            </a>
          )}
          {details && (
            <pre className="m-0 mt-3 whitespace-pre-wrap text-xs bg-red-100 dark:bg-red-900/40 p-2 rounded">
              {details}
            </pre>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}
