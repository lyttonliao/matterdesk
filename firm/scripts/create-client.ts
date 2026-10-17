// BIG PICTURE
// Admin script: creates one client. Runs as the database owner
// node --env-file=.env scripts/create-client.ts "Jane Smith" 1950-03-14
import postgres from "postgres";

const [fullName, dob] = process.argv.slice(2);
const url = process.env.DATABASE_URL;

if (!fullName || (dob && !/^\d{4}-\d{2}-\d{2}$/.test(dob))) {
  console.error(
    'usage: node --env-file=.env scripts/create-client.ts <full name>" [yyyy-mm-dd]',
  );
  process.exit(1);
}
if (!url) throw new Error("DATABASE_URL (owner role) is required");

const sql = postgres(url);
const [client] = await sql`
  insert into clients(full_name, dob)
  values(${fullName}, ${dob ?? null})
  returning id, full_name`;
console.log("created", client);
await sql.end();
