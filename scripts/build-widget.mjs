import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const projectPath = (relativePath) => fileURLToPath(new URL(`../${relativePath}`, import.meta.url));

await mkdir(projectPath("public/rmmz-test"), { recursive: true });
await mkdir(projectPath("integrations/android/current-app-mirror/app/src/main/assets/js/plugins"), { recursive: true });

await Promise.all([
  build({
    entryPoints: [projectPath("integrations/web/account-widget/wonderlang-account.js")],
    bundle: true,
    minify: true,
    sourcemap: false,
    format: "iife",
    target: ["es2020"],
    outfile: projectPath("public/wonderlang-account.js")
  }),
  build({
    entryPoints: [projectPath("integrations/web/admin-console/admin.js")],
    bundle: true,
    minify: true,
    sourcemap: false,
    format: "iife",
    target: ["es2020"],
    outfile: projectPath("public/admin.js")
  }),
  build({
    entryPoints: [projectPath("integrations/web/setup-status/setup.js")],
    bundle: true,
    minify: true,
    sourcemap: false,
    format: "iife",
    target: ["es2020"],
    outfile: projectPath("public/setup.js")
  }),
  copyFile(
    projectPath("integrations/rmmz/WonderLangAccountCloudSync.js"),
    projectPath("public/rmmz-test/WonderLangAccountCloudSync.js")
  ),
  copyFile(
    projectPath("integrations/rmmz/WonderLangDesktopAccountBridge.js"),
    projectPath("public/rmmz-test/WonderLangDesktopAccountBridge.js")
  ),
  copyFile(
    projectPath("integrations/rmmz/WonderLangAccountCloudSync.js"),
    projectPath("integrations/android/current-app-mirror/app/src/main/assets/js/plugins/WonderLangAccountCloudSync.js")
  )
]);
