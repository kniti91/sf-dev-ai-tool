import { getLLMProvider } from '../llm/index.js';
import { CREATE_VALIDATION_RULE_PROMPT } from '../llm/promptTemplates.js';

export async function promptToValidationRuleIntent(prompt, blueprint) {
  const llm = getLLMProvider();

  const raw = await llm.generate({
    system: CREATE_VALIDATION_RULE_PROMPT.system,
    user: CREATE_VALIDATION_RULE_PROMPT.user(prompt, blueprint)
  });

  let intent;
  try {
    intent = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON from LLM:\n${raw}`);
  }

  return intent;
}
