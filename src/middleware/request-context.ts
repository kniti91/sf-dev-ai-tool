import { randomUUID } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'

export function requestContext(request: Request, response: Response, next: NextFunction) {
  request.correlationId = request.header('x-correlation-id') || randomUUID()
  response.setHeader('x-correlation-id', request.correlationId)
  next()
}
