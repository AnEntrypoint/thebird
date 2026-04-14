const args = Deno.args.slice();
const modelIdx = args.indexOf('--model');
const model = modelIdx >= 0 ? args.splice(modelIdx, 2)[1] : 'gemini-2.5-flash';
const sysIdx = args.indexOf('--system');
const system = sysIdx >= 0 ? args.splice(sysIdx, 2)[1] : undefined;
const providerIdx = args.indexOf('--provider');
const provider = providerIdx >= 0 ? args.splice(providerIdx, 2)[1] : 'gemini';
const baseIdx = args.indexOf('--base-url');
const baseUrl = baseIdx >= 0 ? args.splice(baseIdx, 2)[1] : null;
const prompt = args.join(' ').trim();

if (!prompt) throw new Error('Usage: deno run --allow-net --allow-env wasi/cli.ts [--model M] [--system S] [--provider gemini|openai|...] [--base-url URL] <prompt>');

const PROVIDERS: Record<string, { url: string; keyEnv: string; type: 'gemini' | 'openai' }> = {
  gemini:   { url: 'https://generativelanguage.googleapis.com/v1beta', keyEnv: 'GEMINI_API_KEY',   type: 'gemini' },
  openai:   { url: 'https://api.openai.com/v1',                        keyEnv: 'OPENAI_API_KEY',   type: 'openai' },
  xai:      { url: 'https://api.x.ai/v1',                              keyEnv: 'XAI_API_KEY',      type: 'openai' },
  groq:     { url: 'https://api.groq.com/openai/v1',                   keyEnv: 'GROQ_API_KEY',     type: 'openai' },
  mistral:  { url: 'https://api.mistral.ai/v1',                        keyEnv: 'MISTRAL_API_KEY',  type: 'openai' },
  deepseek: { url: 'https://api.deepseek.com/v1',                      keyEnv: 'DEEPSEEK_API_KEY', type: 'openai' },
  custom:   { url: baseUrl || '',                                       keyEnv: 'API_KEY',          type: 'openai' },
};

const prov = PROVIDERS[provider] || PROVIDERS.custom;
const resolvedUrl = baseUrl || prov.url;
const apiKey = Deno.env.get(prov.keyEnv) || Deno.env.get('API_KEY') || '';
if (!apiKey && provider !== 'custom') throw new Error(`${prov.keyEnv} env var required`);

const enc = new TextEncoder();

async function streamGemini() {
  const contents = [{ role: 'user', parts: [{ text: prompt }] }];
  const body: Record<string, unknown> = { contents, generationConfig: { maxOutputTokens: 8192, temperature: 0.7 } };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  const res = await fetch(resolvedUrl + '/models/' + model + ':streamGenerateContent?alt=sse&key=' + apiKey, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Gemini API ' + res.status + ': ' + await res.text());
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop()!;
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const json = line.slice(6).trim();
      if (!json || json === '[DONE]') continue;
      try {
        const chunk = JSON.parse(json);
        for (const c of (chunk.candidates || []))
          for (const p of (c.content?.parts || []))
            if (p.text && !p.thought) await Deno.stdout.write(enc.encode(p.text));
      } catch { /* skip malformed */ }
    }
  }
}

async function streamOpenAI() {
  const messages: unknown[] = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });
  const url = resolvedUrl.replace(/\/$/, '') + '/chat/completions';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, stream: true, max_tokens: 8192 }),
  });
  if (!res.ok) throw new Error('API ' + res.status + ': ' + await res.text());
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop()!;
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const d = line.slice(6).trim();
      if (!d || d === '[DONE]') continue;
      try {
        const chunk = JSON.parse(d);
        const text = chunk.choices?.[0]?.delta?.content;
        if (text) await Deno.stdout.write(enc.encode(text));
      } catch { /* skip malformed */ }
    }
  }
}

await (prov.type === 'gemini' ? streamGemini() : streamOpenAI());
await Deno.stdout.write(enc.encode('\n'));
