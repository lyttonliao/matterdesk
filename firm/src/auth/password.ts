// BIG PICTURE
// Password hashing with Argon2id, hashPassword() runs at signup / password
// change and returns one self-describing string (algorithm, cost parameters,
// salt, hash) that goes into users.password_hash. verifyPassword() runs at login.
// Because the cost parameters live inside the stored string, we can raise them later
// and old hashes sitll verify
import { hash, verify } from "@node-rs/argon2";

// OWASP minimum for Argod2id: 19 MiB memory, 2 iterations, 1 lane
// Numbers are in KiB / passes / threads. algorithm 2 = Argon2id (the library's
// Algorithm enum is a const enum, which isolatedModules cannot import, so we pass
// the number).
const OPTIONS = {
  algorithm: 2,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

// A real hash of a throwaway string, computed once. verifyPassword() runs against
// it when the email is unknown, so "no such user" and "wrong password" both cost
// one full Argon2 verification and cannot be told apart by response time.
const DUMMY_HASH = await hashPassword("dummy-password-for-timing");

export async function verifyPassword(
  storedHash: string | null,
  password: string,
): Promise<boolean> {
  try {
    const ok = await verify(storedHash ?? DUMMY_HASH, password);
    return ok && storedHash !== null;
  } catch {
    // Malformed stored hash: treat as a failed login, never as a crash that leaks
    // state
    return false;
  }
}
