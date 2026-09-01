// Quick standalone debug: reproduce what the live API's escalation
// call sends to OpenRouter gemini-2.5-pro, and print the raw response.

import fs from 'node:fs/promises';
import path from 'node:path';

const FILE = process.argv[2] ?? path.resolve(
  'uploads/cmtf1scz20000g5s0n621bzef/2026/09/1788222405691-e3772ef040d5bf8c.jpg',
);

const KEY = 'sk-or-v1-***REDACTED***';
const MODEL = process.argv[3] ?? 'google/gemini-2.5-pro';

const buf = await fs.readFile(FILE);
console.log('orig kb=', Math.round(buf.length / 1024));

const jimpMod = await import('jimp');
const Jimp = jimpMod.Jimp;
const img = await Jimp.read(buf);
img.scaleToFit({ w: 2000, h: 2000 });
const scaledBuf = await img.getBuffer('image/jpeg');
const base64 = scaledBuf.toString('base64');
console.log('scaled kb=', Math.round(scaledBuf.length / 1024));

// Use a SHORTER prompt specifically tuned for the gemini-2.5-pro
// escalation: the full SYSTEM_PROMPT (5K+ chars) causes gemini-2.5-pro
// to spend ~3900 of its 4096 max_tokens budget on reasoning, leaving
// only ~150 for the actual JSON output. A short, focused prompt
// avoids reasoning tokens and produces the correct fields in ~400 chars.
const systemPrompt = `You are a Portuguese chartered-accountant auditor extracting fields from a fiscal invoice photo. Return ONLY a valid JSON object with: supplier, supplierNif, customer, customerNif, docNumber, atcud, docDate, dueDate, total, taxAmount, netAmount, iban, currency. Numbers in EUR. No markdown.`;

const body = {
  model: MODEL,
  temperature: 0.0,
  max_tokens: 2048,
  response_format: { type: 'json_object' },
  messages: [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
        { type: 'text', text: `Extract the invoice fields from this document.` },
      ],
    },
  ],
};

const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    authorization: `Bearer ${KEY}`,
  },
  body: JSON.stringify(body),
});

console.log('status=', res.status);
const text = await res.text();
console.log('=== RAW RESPONSE ===');
console.log(text);
try {
  const j = JSON.parse(text);
  const raw = j.choices?.[0]?.message?.content ?? '';
  const finish = j.choices?.[0]?.finish_reason;
  const err = j.error ?? j.choices?.[0]?.error ?? null;
  console.log('finish_reason=', finish, 'len=', raw.length);
  if (err) console.log('error=', JSON.stringify(err));
  console.log('=== JSON CONTENT ===');
  console.log(raw);
} catch (e) {
  // raw text already printed
}
