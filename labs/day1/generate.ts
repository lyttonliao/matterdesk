import { completion } from "./completion.ts";

interface GenerateOptions {
  maxTokens?: number;
  temperature?: number;
}

async function generate(
  text: string,
  { maxTokens = 30, temperature = 0 }: GenerateOptions = {},
) {
  let prompt = text;

  for (let i = 0; i < maxTokens; i++) {
    const res = await completion({ // NOSONAR: each prompt depends on the previous token
      prompt,
      n_predict: 1,
      n_probs: 0,
      temperature,
      kwargs: { cache_prompt: true },
    });

    const { prompt_n, cache_n } = res.timings;
    console.log(`call ${i + 1}: prompt_n=${prompt_n} cache_n=${cache_n}`);

    prompt += res.content;
    if (res.content.trim().endsWith(".") || res.stop_type === "eos") {
      break;
    }
  }

  return prompt;
}

console.log(await generate(
  "The tenant shall pay rent on the first day of the",
  { maxTokens: 30, temperature: 2 }
));
