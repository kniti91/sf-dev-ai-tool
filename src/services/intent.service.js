import { getLLMProvider } from '../llm/index.js';
import { CREATE_FIELD_PROMPT } from '../llm/promptTemplates.js';

export async function promptToIntent(prompt, blueprint) {
  const llm = getLLMProvider();

  const raw = await llm.generate({
    system: CREATE_FIELD_PROMPT.system,
    user: CREATE_FIELD_PROMPT.user(prompt, blueprint)
  });

  let intent;
  try {
    console.log('LLM RAW OUTPUT:', raw);
    intent = JSON.parse(raw);
    console.log('LLM RAW intent:', intent );
  } catch (e) {
    throw new Error(
      `LLM returned invalid JSON.\nRaw output:\n${raw}`
    );
  }

  return intent;
}
