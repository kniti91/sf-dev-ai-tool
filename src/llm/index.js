import { openAIProvider } from './providers/openai.provider.js';

export function getLLMProvider() {
  const provider = process.env.LLM_PROVIDER || 'openai';

  if (provider === 'openai') {
    return openAIProvider;
  }

  throw new Error(`Unsupported LLM provider: ${provider}`);
}
