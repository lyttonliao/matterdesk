import { streamChat } from "./stream.ts";

function longPrompt(nonce: string, clauses = 900): string {
  const body = Array.from(
    { length: clauses },
    (_, i) => `Clause ${i}: the tenant shall pay rent on the first day of each month.`,
  ).join(" ");
  // The nonce comes first: changing an early token invalidates the whole cache.
  return `Contract ${nonce}. ${body}\n\nIn one sentence, what is this contract about?`;
}

async function run(label: string, prompt: string, maxTokens: number) {
  const r = await streamChat({ prompt, maxTokens });
  console.log(
    `${label.padEnd(18)} ttft=${(r.ttftMs / 1000).toFixed(2)}s  ` +
      `decode=${r.decodeTokPerSec.toFixed(1)} tok/s  tokens=${r.tokens}  ` +
      `server: prompt_n=${r.server?.prompt_n} cache_n=${r.server?.cache_n} predicted_n=${r.server?.predicted_n}`,
  );
}

const nonce = String(Date.now());
await run("short", "Explain what a lease is in two sentences.", 50);
await run("long, cold", longPrompt(nonce), 30);
await run("long, warm", longPrompt(nonce), 30);
