import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";

await mkdir("public/rmmz-test", { recursive: true });
await mkdir("integrations/android/current-app-mirror/app/src/main/assets/js/plugins", { recursive: true });

await Promise.all([
  build({
    entryPoints: ["integrations/web/account-widget/wonderlang-account.js"],
    bundle: true,
    minify: true,
    sourcemap: false,
    format: "iife",
    target: ["es2020"],
    outfile: "public/wonderlang-account.js"
  }),
  build({
    entryPoints: ["integrations/web/admin-console/admin.js"],
    bundle: true,
    minify: true,
    sourcemap: false,
    format: "iife",
    target: ["es2020"],
    outfile: "public/admin.js"
  }),
  build({
    entryPoints: ["integrations/web/setup-status/setup.js"],
    bundle: true,
    minify: true,
    sourcemap: false,
    format: "iife",
    target: ["es2020"],
    outfile: "public/setup.js"
  }),
  copyFile(
    "integrations/rmmz/WonderLangAccountCloudSync.js",
    "public/rmmz-test/WonderLangAccountCloudSync.js"
  ),
  copyFile(
    "integrations/rmmz/WonderLangAccountCloudSync.js",
    "integrations/android/current-app-mirror/app/src/main/assets/js/plugins/WonderLangAccountCloudSync.js"
  )
]);
