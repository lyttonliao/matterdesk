import { schema } from "./env.schema";
import { describe, expect, it } from "vitest";

describe("environment schema", () => {
  it("accepts a valid DATABASE_URL", () => {
    const result = schema.safeParse({
      DATABASE_URL: "postgres://firm:firm_dev@127.0.0.1:5433/firm",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a malformed DATABASE_URL", () => {
    const result = schema.safeParse({ DATABASE_URL: "not a url" });
    expect(result.success).toBe(false);
  });

  it("rejects a missing DATABASE_URL", () => {
    const result = schema.safeParse({});
    expect(result.success).toBe(false);
  });
});
