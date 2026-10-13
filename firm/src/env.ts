// BIG PICTURE
// Validated, typed environment variables. Parsing at import time makes a missing or
// malformed variable crash at boot with a readable error instead of failing inside a
// request. Import `env` instead of reading process.env directly.
import { schema } from "./env.schema";

export const env = schema.parse(process.env);
