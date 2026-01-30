import crypto from 'crypto';
import jsforce from 'jsforce';
import { getOAuth2 } from '../salesforce/auth.js';

const pkceStore = new Map();
const PKCE_TTL_MS = 5 * 60 * 1000;

function rememberPkceVerifier(state, codeVerifier) {
  const expiresAt = Date.now() + PKCE_TTL_MS;
  pkceStore.set(state, { codeVerifier, expiresAt });
}

function takePkceVerifier(state) {
  if (!state) {
    return undefined;
  }
  const entry = pkceStore.get(state);
  pkceStore.delete(state);
  if (!entry || entry.expiresAt < Date.now()) {
    return undefined;
  }
  return entry.codeVerifier;
}

export function startOAuthLogin() {
  const oauth2 = getOAuth2({ useVerifier: true });
  if (!oauth2.codeVerifier) {
    throw new Error('Unable to initialize PKCE verifier.');
  }

  const state = crypto.randomBytes(16).toString('hex');
  rememberPkceVerifier(state, oauth2.codeVerifier);

  return oauth2.getAuthorizationUrl({
    scope: 'full refresh_token',
    state
  });
}

export function getFirstQueryValue(value) {
  if (Array.isArray(value)) {
    return getFirstQueryValue(value[0]);
  }
  if (value && typeof value === 'object') {
    const firstKey = Object.keys(value)[0];
    return typeof firstKey === 'undefined'
      ? undefined
      : getFirstQueryValue(value[firstKey]);
  }
  return value;
}

export function resolveAuthorizationCode(query) {
  const directCode = getFirstQueryValue(query?.code);
  if (typeof directCode === 'string' && directCode) {
    return directCode;
  }

  for (const key of Object.keys(query ?? {})) {
    if (!key.startsWith('code[')) continue;
    const nestedValue = getFirstQueryValue(query[key]);
    if (typeof nestedValue === 'string' && nestedValue) {
      return nestedValue;
    }
  }
  return undefined;
}

export function extractState(query) {
  return getFirstQueryValue(query?.state);
}

export function getUpstreamError(query) {
  const error = getFirstQueryValue(query?.error);
  if (!error) {
    return null;
  }
  const description = getFirstQueryValue(query?.error_description);
  return {
    error,
    description: typeof description === 'string' ? description : undefined
  };
}

export function consumePkceVerifier(state) {
  return takePkceVerifier(state);
}

export async function exchangeCodeForTokens({ code, codeVerifier }) {
  const oauth2 = getOAuth2();
  oauth2.codeVerifier = codeVerifier;

  const conn = new jsforce.Connection({ oauth2 });
  await conn.authorize(code);

  return {
    accessToken: conn.accessToken,
    instanceUrl: conn.instanceUrl,
    userId: conn.userInfo.id,
    orgId: conn.userInfo.organizationId
  };
}
