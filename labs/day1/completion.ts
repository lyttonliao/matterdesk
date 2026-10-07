interface CompletionRequest {
  prompt: string;
  n_predict: number;
  n_probs: number;
}

interface CompletionResponse {
  content: string;
  tokens: string[];
  probs: object[];
}

const BASE_URL = "http://localhost:8080";

async function completion(req: CompletionRequest): Promise<CompletionResponse> {
  console.log(req)
  const response = await fetch(`${BASE_URL}/completion`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req), 
  });

  if (!response.ok) {
    throw new Error(`completion request failed: HTTP ${response.status}`);
  }

  const data = (await response.json()) as CompletionResponse;
  return data;
}

const args = {
  prompt: "The tenant shall pay rent on the first day of the",
  n_predict: 1,
  n_probs: 5
}

const data = await completion(args);
console.log(JSON.stringify(data, null, 2));