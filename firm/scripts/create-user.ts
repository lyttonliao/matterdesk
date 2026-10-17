// BIG PICTURE
// Admin script: creates one user with an Argon2id-hashed password
// Runs as the database owner (DATABASE_URL), not firm_app, because it is an
// operator task and not app traffic. The password comes from an environment variable
// so it never lands in shell history or in `ps` output.
// read -s PW && NEW_USER_PASSWORD=$PW node --env-file=.env scripts/create-user.ts \
// alice@firm.test alice "Alice Attorney" attorney
import postgres from "postgres";
import { hashPassword } from "../src/auth/password.ts";

const ROLES = ["client", "attorney", "paralegal", "admin"];
const [email, username, fullName, role] = process.argv.slice(2);
const password = process.env.NEW_USER_PASSWORD;
const url = process.env.DATABASE_URL;

if (!email || !username || !fullName || !ROLES.includes(role) || !password) {
  console.error(
    `usage: NEW_USER_PASSWORD=... node --env-file=.env scripts/create-user.ts <email> <username> "<full name>" <${ROLES.join("|")}>`,
  );
  process.exit(1);
}
if (!url) throw new Error("DATABASE_URL (owner role) is required");

const sql = postgres(url);
const [user] = await sql`
  insert into users(full_name, username, password_hash, email, role)
  values(${fullName}, ${username}, ${await hashPassword(password)}, ${email.toLowerCase()}, ${role})
  returning id, email, role`;
console.log("created", user);
await sql.end();
