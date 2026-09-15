/**
 * Reset an account's password when you no longer know the current one.
 *
 *   npm run db:reset-password -- owner 'new-password'
 *   npm run db:reset-password -- staff 'new-password'
 *
 * The owner screen can only *change* a password given the current one, and
 * the seed refuses to touch an account that already exists — so a lost or
 * never-known password otherwise locks the account out for good. This is the
 * way back in.
 *
 * It connects to nothing. It hashes the password locally with the same scrypt
 * parameters the app verifies against, and prints one SQL statement. Paste
 * that into the Neon console's SQL Editor (Project → SQL Editor) and Run —
 * which needs only a browser, so it works from the same phone you are locked
 * out on. The statement is an upsert, so it repairs a missing account row as
 * well as a wrong password. The plaintext never appears in the output; only
 * its hash does, and a hash cannot be turned back into the password.
 */
import { hashPassword } from "../src/lib/password";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "../src/lib/validation";

const USAGE =
  "Usage: npm run db:reset-password -- <owner|staff> '<new password>'";

async function main() {
  const role = process.argv[2];
  const password = process.argv[3] ?? "";

  if (role !== "owner" && role !== "staff") {
    console.error(USAGE);
    process.exit(1);
  }
  // Mirror the app's own rule (src/lib/validation.ts) so the reset cannot set
  // a password the login form would later refuse to accept.
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    console.error(
      `Password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters.`,
    );
    console.error(USAGE);
    process.exit(1);
  }

  const hash = await hashPassword(password);

  // The username column doubles as the role — one shared `staff` account and
  // one `owner` account (see the schema). Both values are fixed literals
  // here, never user text, and a scrypt hash is base64 with no quote to
  // escape, so there is nothing to inject.
  const statement =
    `INSERT INTO users (username, role, password_hash)\n` +
    `VALUES ('${role}', '${role}', '${hash}')\n` +
    `ON CONFLICT (username) DO UPDATE\n` +
    `  SET password_hash = EXCLUDED.password_hash, updated_at = now();`;

  console.log(`-- Sets the ${role} password. Paste into the Neon SQL Editor and Run.`);
  console.log(`-- Existing sessions stay signed in; share the new password with whoever needs it.`);
  console.log(statement);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
