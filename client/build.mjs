import { build } from "esbuild";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/heartblade.js",
  bundle: true,
  format: "iife",
  platform: "neutral",
  target: "es2019",          // Hermes-friendly output
  minify: process.env.HB_DEBUG ? false : true,
  legalComments: "none",
  define: { __HB_VERSION__: JSON.stringify(pkg.version) },
  logLevel: "info",
});
