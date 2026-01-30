import { Router } from 'express';
import {
  consumePkceVerifier,
  exchangeCodeForTokens,
  extractState,
  getUpstreamError,
  resolveAuthorizationCode,
  startOAuthLogin
} from '../services/oauthService.js';
import { createSession } from '../services/sessionService.js';

const router = Router();

router.get('/login', (req, res) => {
  try {
    const authUrl = startOAuthLogin();
    res.redirect(authUrl);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/callback', async (req, res) => {
  const upstreamError = getUpstreamError(req.query);
  if (upstreamError) {
    return res.status(400).json(upstreamError);
  }

  const code = resolveAuthorizationCode(req.query);
  if (typeof code !== 'string' || !code) {
    return res
      .status(400)
      .json({ error: 'Missing or malformed Salesforce authorization code.' });
  }

  const state = extractState(req.query);
  const codeVerifier = consumePkceVerifier(state);
  if (!codeVerifier) {
    return res.status(400).json({
      error: 'Missing PKCE verifier. Please restart the Salesforce login flow.'
    });
  }

  try {
    const oauthResult = await exchangeCodeForTokens({ code, codeVerifier });

    const sessionId = createSession(oauthResult);
    // Basic cookie settings for local development; tweak as needed for prod.
    res.cookie('sfSessionId', sessionId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      path: '/'
    });

    res.json({
      success: true,
      sessionId,
      ...oauthResult
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
