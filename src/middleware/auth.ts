import type { NextFunction, Request, Response } from 'express'
import { ApiError } from '../lib/errors.js'
import type { AuthService } from '../services/auth-service.js'
import { config } from '../config.js'

export const sessionCookieName = 'vibesafe_session'

export function attachSession(authService: AuthService) {
  return async (request: Request, _response: Response, next: NextFunction) => {
    const auth = await authService.authenticate(request.cookies?.[sessionCookieName] as string | undefined)
      ?? (config.AUTH_BYPASS && config.NODE_ENV !== 'production' ? await authService.developmentIdentity() : undefined)
    if (auth) { request.userId = auth.user.id; request.tenantId = auth.tenantId }
    next()
  }
}

export function requireAuth(request: Request, _response: Response, next: NextFunction) {
  if (!request.userId || !request.tenantId) return next(new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Sign in to continue.'))
  next()
}
