const BASE = 'https://generativelanguage.googleapis.com/v1beta';

const args = Deno.args.slice();
const modelIdx = args.indexOf('--model');
const model = modelIdx >= 0 ? args.splice(modelIdx, 2)[1] : 'gemini-2.5-flash';
const sysIdx = args.indexOf('--system');
const system = sysIdx >= 0 ? args.splice(sysIdx, 2)[1] : undefined;
const prompt = args.join(' ').trim();

const apiKey = Deno.env.get('GEMINI_API_KEY');
if (!apiKey) throw new Error('GEMINI_API_KEY env var required');
if (!prompt) throw new Error('Usage: deno run --allow-net --allow-env wasi/cli.ts [--model MODEL] [--system SYSTEM] <prompt>');

const contents = [{ role: 'user', parts: [{ text: prompt }] }];
const body = { contents, generationConfig: { maxOutputTokens: 8192, temperature: 0.7 } };
if (system) body.systemInstruction = { parts: [{ text: system }] };

const res = await fetch(BASE + '/models/' + model + ':streamGenerateContent?alt=sse&key=' + apiKey, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
if (!res.ok) throw new Error('Gemini API ' + res.status + ': ' + await res.text());

const reader = res.body.getReader();
const dec = new TextDecoder();
const enc = new TextEncoder();
let buf = '';
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buf += dec.decode(value, { stream: true });
  const lines = buf.split('\n');
  buf = lines.pop();
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    const json = line.slice(6).trim();
    if (!json || json === '[DONE]') continue;
    try {
      const chunk = JSON.parse(json);
      for (const c of (chunk.candidates || []))
        for (const p of (c.content?.parts || []))
          if (p.text && !p.thought) await Deno.stdout.write(enc.encode(p.text));
    } catch {}
  }
}
await Deno.stdout.write(enc.encode('\n'));
