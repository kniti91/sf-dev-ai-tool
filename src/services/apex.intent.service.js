import { getLLMProvider } from '../llm/index.js';
import { CREATE_APEX_CLASS_PROMPT } from '../llm/promptTemplates.js';

export async function promptToApexClassIntent(prompt) {
  const llm = getLLMProvider();

  const raw = await llm.generate({
    system: CREATE_APEX_CLASS_PROMPT.system,
    user: CREATE_APEX_CLASS_PROMPT.user(prompt)
  });

  let intent;
  try {
    intent = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON from LLM:\n${raw}`);
  }

  return intent;
}
