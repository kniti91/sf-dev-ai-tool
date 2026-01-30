import crypto from 'crypto';

const sessions = new Map();

/**
 * sessionId -> { accessToken, instanceUrl, userId, orgId }
 */
export function createSession(data) {
  const sessionId = crypto.randomUUID();
  sessions.set(sessionId, { ...data, createdAt: Date.now() });
  return sessionId;
}

export function getSession(sessionId) {
  return sessionId ? sessions.get(sessionId) : undefined;
}
