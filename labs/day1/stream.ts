interface StreamRequest {
  prompt: string;
  maxTokens?: number;
}

// The server's own timing numbers, sent in the last chunk. We use them to
// cross-check what we measured on the client.
interface ServerTimings {
  prompt_n: number; // tokens the server had to compute from scratch (prefill)
  cache_n: number; // tokens it reused from the KV cache
  predicted_n: number; // tokens it generated
}

interface StreamResult {
  text: string;
  ttftMs: number; // time to first token: request sent -> first token received
  tokens: number;
  decodeTokPerSec: number; // generation speed, prefill excluded
  totalMs: number;
  server?: ServerTimings;
}

// The part of each streamed JSON event that we read.
interface ChatChunk {
  choices: { delta: { content?: string | null }; finish_reason: string | null }[];
  timings?: ServerTimings; // only present on the last chunk
}

const BASE_URL = "http://localhost:8080";

async function streamChat({
  prompt,
  maxTokens = 50,
}: StreamRequest): Promise<StreamResult> {
  // performance.now() is a monotonic clock (never jumps backwards), unlike Date.now().
  // Start it before the request so TTFT includes the whole wait.
  const start = performance.now();

  // fetch resolves as soon as the response HEADERS arrive. The body is still
  // being generated, and we read it as a stream below.
  const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: prompt }], // chat endpoint applies Qwen's chat template
      max_tokens: maxTokens,
      stream: true, // reply with Server-Sent Events instead of one JSON object
      temperature: 0,
    }),
  });

  if (!response.ok) {
    throw new Error(`stream request failed: HTTP ${response.status}`);
  }
  // TypeScript types body as nullable, so check once here.
  if (!response.body) {
    throw new Error("stream request failed: response has no body");
  }

  const decoder = new TextDecoder(); // turns raw bytes into a string
  let buffer = ""; // text received but not yet processed (may end mid-event)
  let text = ""; // the generated answer, built up token by token
  let tokens = 0;
  let firstTokenAt: number | undefined; // set once, when the first token arrives
  let lastTokenAt = start;
  let server: ServerTimings | undefined;

  // Each iteration gives us whatever bytes the network delivered next. That
  // might be several events, half an event, or one event.
  for await (const bytes of response.body) {
    // { stream: true } tells the decoder that more bytes may follow, so a
    // multi-byte character split across two chunks is decoded correctly.
    buffer += decoder.decode(bytes, { stream: true });

    // An SSE event ends with a blank line ("\n\n"). Everything before the
    // last "\n\n" is complete events; whatever is after it may be cut off.
    const events = buffer.split("\n\n");
    // Take the last (possibly incomplete) piece out of the list and keep it in
    // the buffer. The next network chunk will complete it.
    buffer = events.pop() ?? "";

    for (const event of events) {
      // Each event is a line like: data: {"choices":[...]}
      if (!event.startsWith("data: ")) continue;
      const payload = event.slice("data: ".length);
      if (payload === "[DONE]") continue; // end-of-stream marker, not JSON

      const chunk = JSON.parse(payload) as ChatChunk;
      if (chunk.timings) server = chunk.timings; // last chunk carries the server's numbers

      // delta.content is the new token's text. The first chunk (role only)
      // and the last chunk (finish_reason) have no content, so they are not tokens.
      const content = chunk.choices[0]?.delta.content;
      if (!content) continue;

      const now = performance.now();
      firstTokenAt ??= now; // keep the first value, never overwrite it
      lastTokenAt = now;
      tokens++;
      text += content;
    }
  }

  const end = performance.now();
  if (firstTokenAt === undefined) {
    throw new Error("stream ended without producing a token");
  }

  // n tokens have only n - 1 gaps between them. Measuring from the first token
  // to the last leaves out prefill, so this is pure generation speed.
  const decodeSeconds = (lastTokenAt - firstTokenAt) / 1000;
  const decodeTokPerSec = tokens > 1 ? (tokens - 1) / decodeSeconds : 0;

  return {
    text,
    ttftMs: firstTokenAt - start,
    tokens,
    decodeTokPerSec,
    totalMs: end - start,
    server,
  };
}

export { streamChat };
export type { StreamResult };
