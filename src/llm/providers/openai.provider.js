import 'dotenv/config';
import OpenAI from 'openai';

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  throw new Error(
    'Missing OPENAI_API_KEY. Set it in backend/.env (OPENAI_API_KEY=sk-...).'
  );
}

const client = new OpenAI({ apiKey });

export const openAIProvider = {
  async generate({ system, user }) {
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini', // cheap + very good at JSON
      temperature: 0,       // IMPORTANT: deterministic
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    });

    return response.choices[0].message.content;
  }
};
