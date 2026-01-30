import Ajv from 'ajv';
import { INTENT_SCHEMAS } from '../intents/index.js';

const ajv = new Ajv();

export function validateIntent(intentJson) {
  const schema = INTENT_SCHEMAS[intentJson.intent];

  if (!schema) {
    throw new Error(`Unsupported intent: ${intentJson.intent}`);
  }

  const validate = ajv.compile(schema);
  const valid = validate(intentJson);

  if (!valid) {
    throw new Error(JSON.stringify(validate.errors));
  }

  return true;
}
