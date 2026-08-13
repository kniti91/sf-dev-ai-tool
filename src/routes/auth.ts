import { Router } from 'express'
import { z } from 'zod'
import { config } from '../config.js'
import { ApiError } from '../lib/errors.js'
import { sessionCookieName } from '../middleware/auth.js'
import type { AuthService } from '../services/auth-service.js'

const email = z.string().trim().email().max(254)
const password = z.string().min(8).max(128)
const cookieOptions = { httpOnly: true, sameSite: 'lax' as const, secure: config.NODE_ENV === 'production', maxAge: 7 * 24 * 60 * 60 * 1000, path: '/' }

export function createAuthRouter(authService: AuthService) {
  const router = Router()
  router.post('/signup', async (request, response) => {
    const input = z.object({ displayName: z.string().trim().min(2).max(100), email, password }).parse(request.body)
    const result = await authService.signup(input.email, input.password, input.displayName)
    response.cookie(sessionCookieName, result.token, cookieOptions).status(201).json({ data: { user: result.user, tenant: { id: result.tenantId, name: `${result.user.displayName}'s workspace` } } })
  })
  router.post('/login', async (request, response) => {
    const input = config.AUTH_BYPASS && config.NODE_ENV !== 'production'
      ? z.object({ email: z.string().default(''), password: z.string().default('') }).parse(request.body)
      : z.object({ email, password }).parse(request.body)
    const result = config.AUTH_BYPASS && config.NODE_ENV !== 'production'
      ? await authService.bypassLogin(input.email)
      : await authService.login(input.email, input.password)
    response.cookie(sessionCookieName, result.token, cookieOptions).json({ data: { user: result.user, tenant: { id: result.tenantId, name: 'VibeSafe workspace' } } })
  })
  router.post('/logout', async (request, response) => {
    await authService.logout(request.cookies?.[sessionCookieName] as string | undefined)
    response.clearCookie(sessionCookieName, { path: '/' }).status(204).send()
  })
  router.post('/forgot-password', async (request, response) => {
    const input = z.object({ email }).parse(request.body)
    await authService.requestPasswordReset(input.email)
    response.status(202).json({ data: { message: 'If an account exists, password reset instructions will be sent.' } })
  })
  router.get('/session', async (request, response) => {
    const auth = await authService.authenticate(request.cookies?.[sessionCookieName] as string | undefined)
      ?? (config.AUTH_BYPASS && config.NODE_ENV !== 'production' ? await authService.developmentIdentity() : undefined)
    if (!auth) throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Sign in to continue.')
    response.json({ data: { user: auth.user, tenant: { id: auth.tenantId, name: 'VibeSafe workspace' } } })
  })
  return router
}
