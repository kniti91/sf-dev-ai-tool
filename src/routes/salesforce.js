import { Router } from 'express';
import { describeObject } from '../services/salesforceService.js';
import { buildAndStoreBlueprint } from '../services/blueprintService.js';
import { getSalesforceConnection } from '../salesforce/auth.js';
import { getSession } from '../services/sessionService.js';

const router = Router();

router.get('/describe/account', async (req, res) => {
  try {
    const meta = await describeObject('Account');
    res.json(meta.fields.map(f => f.name));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});


router.get('/blueprint', async (req, res) => {
  try {
    const sessionId = extractSessionId(req);
    if (!sessionId) {
      return res.status(401).json({ error: 'Missing session cookie' });
    }
    const session = getSession(sessionId);
    if (!session) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }

    const conn = getSalesforceConnection(session.accessToken, session.instanceUrl);

    const blueprint = await buildAndStoreBlueprint(conn);

    res.json({
      success: true,
      objectCount: Object.keys(blueprint.objects).length
    });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

function extractSessionId(req) {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) {
    return undefined;
  }
  const cookies = cookieHeader.split(';').map(chunk => chunk.trim());
  for (const cookie of cookies) {
    const [name, ...rest] = cookie.split('=');
    if (name === 'sfSessionId') {
      return decodeURIComponent(rest.join('='));
    }
  }
  return undefined;
}

export default router;
