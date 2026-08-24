import { spawnSync } from "node:child_process";

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  throw new Error("npm_execpath is unavailable. Run this through npm run test:rules.");
}

const result = spawnSync(process.execPath, [
  npmCli,
  "exec",
  "--yes",
  "--package=firebase-tools@15.28.1",
  "--",
  "firebase",
  "emulators:exec",
  "--project",
  "demo-wonderlang-entitlements",
  "--only",
  "firestore,storage",
  "vitest run test/firebase-rules.test.ts"
], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit"
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
