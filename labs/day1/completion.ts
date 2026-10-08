interface CompletionRequest {
  prompt: string;
  n_predict?: number;
  n_probs?: number;
  temperature?: number;
  kwargs?: Record<string, any>;
}

interface CompletionResponse {
  content: string;
  tokens: string[];
  stop_type: "none" | "eos" | "limit" | "word";
  timings: { prompt_n: number; cache_n: number };
}

const BASE_URL = "http://localhost:8080";

async function completion({
  prompt,
  n_predict = 1,
  n_probs = 5,
  temperature = 0.0,
  kwargs = {},
}: CompletionRequest): Promise<CompletionResponse> {
  const response = await fetch(`${BASE_URL}/completion`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt, n_predict, n_probs, temperature, ...kwargs }), 
  });

  if (!response.ok) {
    throw new Error(`completion request failed: HTTP ${response.status}`);
  }

  const data = (await response.json()) as CompletionResponse;
  return data;
}

// const args = {
//   prompt: "The tenant shall pay rent on the first day of the month",
//   n_predict: 1,
//   n_probs: 5
// }

// const data = await completion(args);
// console.log(JSON.stringify(data, null, 2));

export { completion };