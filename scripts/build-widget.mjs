import { build } from "esbuild";

await build({
  entryPoints: ["integrations/web/account-widget/wonderlang-account.js"],
  bundle: true,
  minify: true,
  sourcemap: false,
  format: "iife",
  target: ["es2020"],
  outfile: "public/wonderlang-account.js"
});
