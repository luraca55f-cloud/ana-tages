import { spawnSync } from "node:child_process";

const runtimeSecretNames = [
  "TEST_LOGIN_EMAIL",
  "TEST_LOGIN_PASSWORD",
  "SUPABASE_PROJECT_REF",
  "SUPABASE_MANAGEMENT_TOKEN",
  "VAULT_RECOVERY_SECRET",
];

const present = runtimeSecretNames.filter((name) => typeof process.env[name] === "string" && process.env[name].length > 0);

// Local builds normally do not have Cloudflare build secrets. In that case this
// script intentionally does nothing and keeps `npm run build` usable offline.
if (present.length === 0) {
  console.log("Runtime secret sync skipped: no Cloudflare build secrets detected.");
  process.exit(0);
}

const missing = runtimeSecretNames.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`Runtime secret sync aborted. Missing build secret(s): ${missing.join(", ")}`);
  process.exit(1);
}

const secrets = Object.fromEntries(runtimeSecretNames.map((name) => [name, process.env[name]]));

console.log(`Syncing ${runtimeSecretNames.length} runtime secret bindings for Worker ana-tages...`);
const result = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["wrangler", "secret", "bulk", "--name", "ana-tages"],
  {
    input: JSON.stringify(secrets),
    encoding: "utf8",
    stdio: ["pipe", "inherit", "inherit"],
    env: process.env,
  },
);

if (result.error) {
  console.error("Runtime secret sync failed to start:", result.error.message);
  process.exit(1);
}
if (result.status !== 0) {
  console.error(`Runtime secret sync failed with exit code ${result.status ?? "unknown"}.`);
  process.exit(result.status ?? 1);
}

console.log("Runtime secret bindings synchronized successfully.");
