import { generate } from './dist/js/component.js';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) throw new Error('GEMINI_API_KEY env var required');

const messages = [
  {
    role: 'user',
    content: [{ kind: 'text', text: 'Say hello in exactly 5 words.' }],
  },
];

const config = {
  model: 'gemini-2.0-flash',
  apiKey,
  system: null,
  temperature: 0.7,
  maxOutputTokens: 256,
};

const result = await generate(messages, config);
if (result.error) throw new Error('generate failed: ' + result.error);
console.log(result.text);
