import express from 'express';
import { getSession } from '../services/sessionService.js';
import { getSalesforceConnection } from '../salesforce/auth.js';

// Your existing intent validator (AJV) — assumed:
import { validateIntent } from '../validators/intentValidator.js';

import { loadBlueprintFromDisk } from '../services/blueprintRead.service.js';
import { validateCreateFieldAgainstBlueprint } from '../validators/blueprintValidator.js';
import { generateCustomFieldXML } from '../generators/field.generator.js';
import { deployCustomField, deployValidationRule, deployApexClass } from '../services/deploy.service.js';

// Your LLM translator — assumed (you said intent is done).
// This function should return intent JSON like { intent:"CREATE_FIELD", object:"Account", field:{...} }
import { promptToIntent } from '../services/intent.service.js';

import { promptToValidationRuleIntent } from '../services/validationRule.intent.service.js';
import { validateValidationRuleAgainstBlueprint } from '../validators/validationRule.blueprintValidator.js';
import { generateValidationRuleXML } from '../generators/validationRule.generator.js';

import { promptToApexClassIntent } from '../services/apex.intent.service.js';
import { generateApexClass } from '../generators/apex.generator.js';
import { validateApexClassAgainstBlueprint } from '../validators/apex.blueprintValidator.js';

import { validateApexIR } from '../validators/apex.irValidator.js';


const router = express.Router();

/**
 * POST /intent/create-field
 * Body: { prompt: "Create a number field Risk Score on Account..." }
 * Header: x-session-id: <sessionId>
 */
router.post('/create-field', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'Missing session id' });

    const session = getSession(sessionId);
    if (!session) return res.status(401).json({ error: 'Invalid session' });

    const { prompt, dryRun } = req.body || {};
    if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

    const blueprint = loadBlueprintFromDisk();
    if (!blueprint || !blueprint.objects) {
      return res.status(500).json({
        error: 'Org blueprint not available. Generate it via /sf/blueprint first.'
      });
    }

    // 1) LLM: Prompt -> Intent JSON
    const intent = await promptToIntent(prompt, blueprint);

    // 2) Schema validation (AJV)
    validateIntent(intent);

    // 3) Blueprint semantic validation
    validateCreateFieldAgainstBlueprint(intent, blueprint);

    // 4) Generate metadata XML
    const objectApiName = intent.object;
    const fieldApiName = intent.field.apiName;
    const fieldXml = generateCustomFieldXML(intent);

    // 5) Deploy: checkOnly first, then real deploy
    const conn = getSalesforceConnection(session.accessToken, session.instanceUrl);

    const check = await deployCustomField(conn, objectApiName, fieldApiName, fieldXml, { checkOnly: true });
    if (!check.success) {
      return res.status(400).json({
        success: false,
        stage: 'checkOnlyDeploy',
        result: check
      });
    }

    if (dryRun === true) {
        return res.json({
            success: true,
            stage: 'intent_preview',
            intent
        });
    }

    const deploy = await deployCustomField(conn, objectApiName, fieldApiName, fieldXml, { checkOnly: false });

    return res.json({
      success: deploy.success,
      stage: 'deployed',
      intent,
      result: deploy
    });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});


router.post('/create-validation-rule', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    const { prompt, dryRun } = req.body;

    const session = getSession(sessionId);
    if (!session) throw new Error('Invalid session');

    const blueprint = loadBlueprintFromDisk();

    const intent = await promptToValidationRuleIntent(prompt, blueprint);
    validateIntent(intent);
    validateValidationRuleAgainstBlueprint(intent, blueprint);

    if (dryRun === true) {
      return res.json({
        success: true,
        stage: 'intent_preview',
        intent
      });
    }

    const xml = generateValidationRuleXML(intent);

    const conn = getSalesforceConnection(
      session.accessToken,
      session.instanceUrl
    );

    const result = await deployValidationRule(
      conn,
      intent.object,
      intent.ruleName,
      xml,
      { checkOnly: false }
    );

    res.json({ success: result.success, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


router.post('/create-apex-class', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    const { prompt, dryRun } = req.body;

    const session = getSession(sessionId);
    if (!session) throw new Error('Invalid session');

    const intent = await promptToApexClassIntent(prompt);

    validateIntent(intent);
    validateApexIR(intent);
    validateApexClassAgainstBlueprint(intent, loadBlueprintFromDisk());

    const apexCode = generateApexClass(intent);

    if (dryRun === true) {
      return res.json({
        success: true,
        stage: 'intent_preview',
        intent,
        apexCode
      });
    }

    const conn = getSalesforceConnection(
      session.accessToken,
      session.instanceUrl
    );

    const result = await deployApexClass(conn, intent.className, apexCode, { checkOnly: false });

    res.json({ success: result.success, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
