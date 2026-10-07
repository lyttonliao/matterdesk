interface TokenPiece {
  id: number;
  piece: string;
}

interface TokenizeResponse {
  tokens: TokenPiece[];
}

const BASE_URL = "http://localhost:8080";

async function tokenize(content: string): Promise<TokenPiece[]> {
  const response = await fetch(`${BASE_URL}/tokenize`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content, with_pieces: true }),
  });

  if (!response.ok) {
    throw new Error(`tokenize failed: HTTP ${response.status}`);
  }

  // `as` is a compile-time claim, not runtime validation: if the server's shape
  // changes, this still compiles and fails later.
  const data = (await response.json()) as TokenizeResponse;
  return data.tokens;
}

const inputs = ["Change of Control", "§ 12.3(b)(iv)", "Acme Holdings, LLC"];

// The requests are independent, so issue them concurrently. Promise.all keeps results in input order.
const results = await Promise.all(inputs.map(tokenize));

inputs.forEach((input, i) => {
  const tokens = results[i] ?? [];
  console.log(`${JSON.stringify(input)} -> ${tokens.length} tokens`);
  for (const { id, piece } of tokens) {
    console.log(`  ${String(id).padStart(7)}  ${JSON.stringify(piece)}`);
  }
});
