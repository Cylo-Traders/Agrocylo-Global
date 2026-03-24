import type { Request, Response } from 'express';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly title: string,
    detail: string,
    public readonly type = 'about:blank',
  ) {
    super(detail);
    this.name = 'ApiError';
  }
}

export function sendProblem(res: Response, req: Request, error: ApiError): void {
  res
    .status(error.status)
    .type('application/problem+json')
    .json({
      type: error.type,
      title: error.title,
      status: error.status,
      detail: error.message,
      instance: req.originalUrl,
    });
}
