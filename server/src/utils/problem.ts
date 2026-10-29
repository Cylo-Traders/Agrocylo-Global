import type { Response } from 'express';

const TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
};

const CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  500: 'INTERNAL_SERVER_ERROR',
  503: 'SERVICE_UNAVAILABLE',
};

/**
 * Sends a minimal RFC 7807 problem+json response.
 * Used by routes that don't have an ApiError instance to hand.
 */
export function sendProblem(res: Response, status: number, message: string): void {
  res
    .status(status)
    .type('application/problem+json')
    .json({
      type: 'about:blank',
      title: TITLES[status] ?? 'Error',
      status,
      detail: message,
      message,
      error: message,
      code: CODES[status] ?? 'INTERNAL_SERVER_ERROR',
      timestamp: new Date().toISOString(),
    });
}
