import { completion } from "./completion.ts";

const PROMPT = "The tenant shall pay rent on the first day of the";
const DRAWS = 100; // samples per cell of the table

// The server's default truncation (top-k 40, top-p 0.95, min-p 0.05) vs. none.
// Truncation runs BEFORE temperature, so with the defaults the shortlist is
// already cut down and temperature has little left to reshape.
const TRUNCATION = {
  "defaults": {},
  "off": { top_k: 0, top_p: 1.0, min_p: 0.0 },
} as const;

const TEMPERATURES = [0, 0.5, 1, 2];

// Draw one next token DRAWS times with different seeds and count how often each came out.
async function sampleNextToken(
  temperature: number,
  truncation: Record<string, number>,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();

  for (let seed = 0; seed < DRAWS; seed++) {
    const res = await completion({ // NOSONAR: sequential on purpose, one request at a time
      prompt: PROMPT,
      n_predict: 1,
      n_probs: 0,
      temperature,
      kwargs: { seed, cache_prompt: true, ...truncation },
    });
    counts.set(res.content, (counts.get(res.content) ?? 0) + 1);
  }

  return counts;
}

console.log(`prompt: "${PROMPT}"  (${DRAWS} draws per row)\n`);
console.log("truncation  T     ' month'  distinct  top 4 tokens");

for (const [name, truncation] of Object.entries(TRUNCATION)) {
  for (const temperature of TEMPERATURES) {
    const counts = await sampleNextToken(temperature, truncation); // NOSONAR: sequential on purpose

    // Sort tokens by how often they were drawn, most frequent first.
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const month = counts.get(" month") ?? 0;
    const top4 = ranked
      .slice(0, 4)
      .map(([token, n]) => `${JSON.stringify(token)}:${n}`)
      .join(" ");

    console.log(
      `${name.padEnd(11)} ${String(temperature).padEnd(5)} ${String(month).padStart(7)}%` +
        `  ${String(counts.size).padStart(8)}  ${top4}`,
    );
  }
}
