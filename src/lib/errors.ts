import type { NextFunction, Request, Response } from 'express'
import { ZodError } from 'zod'

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly details: unknown = {}) {
    super(message)
  }
}

export function notFoundHandler(request: Request, _response: Response, next: NextFunction) {
  next(new ApiError(404, 'ROUTE_NOT_FOUND', `No route matches ${request.method} ${request.path}.`))
}

export function errorHandler(error: unknown, request: Request, response: Response, _next: NextFunction) {
  void _next
  if (error instanceof ZodError) {
    response.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'The request is invalid.', correlationId: request.correlationId, details: error.issues } })
    return
  }
  const apiError = error instanceof ApiError ? error : new ApiError(500, 'INTERNAL_ERROR', 'An unexpected error occurred.')
  if (!(error instanceof ApiError)) console.error(JSON.stringify({ level: 'error', correlationId: request.correlationId, error }))
  response.status(apiError.status).json({ error: { code: apiError.code, message: apiError.message, correlationId: request.correlationId, details: apiError.details } })
}
