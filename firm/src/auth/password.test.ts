import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
  it("verifies the right password and rejects a wrong one", async () => {
    const h = await hashPassword("correct horse");
    expect(await verifyPassword(h, "correct horse")).toBe(true);
    expect(await verifyPassword(h, "wrong horse")).toBe(false);
  });

  it("produces an Argon2id string with a different salt each time", async () => {
    const [a, b] = await Promise.all([hashPassword("x"), hashPassword("x")]);
    expect(a).toMatch(/^\$argon2id\$/);
    expect(a).not.toBe(b);
  });

  it("rejects when there is no stored hash (unknown user)", async () => {
    expect(await verifyPassword(null, "anything")).toBe(false);
  });

  it("rejects a malformed stored hash instead of throwing", async () => {
    expect(await verifyPassword("not a hash", "x")).toBe(false);
  });
});
