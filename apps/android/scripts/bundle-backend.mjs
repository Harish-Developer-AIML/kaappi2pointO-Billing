// Turn a `pnpm deploy`-staged backend (thousands of node_modules files) into a
// compact bundle for the Android app: the app unpacks it with Android's tar on
// first start, and ~17,000 small files took over five minutes on a phone.
//
//   node apps/android/scripts/bundle-backend.mjs <stagedBackendDir> <outDir>
//
// esbuild bundles dist/src/main.js and prisma/apply-migrations.js into single
// files. Packages that load their own files from disk at runtime (Prisma's
// generated client + WASM query compiler, pdfkit's font data, swagger-ui's
// assets) stay external and are copied with their dependency closure.
import { createRequire } from "node:module";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [stagedArg, outArg] = process.argv.slice(2);
if (!stagedArg || !outArg) {
  console.error("usage: bundle-backend.mjs <stagedBackendDir> <outDir>");
  process.exit(1);
}
const staged = resolve(stagedArg);
const out = resolve(outArg);
const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, "../../backend/package.json"));
const esbuild = require("esbuild");

// Kept as real packages in node_modules (they read files next to themselves).
const KEEP = ["@prisma/client", ".prisma", "pdfkit", "swagger-ui-dist"];
// Optional NestJS integrations this app never installs; Nest loads them lazily.
const OPTIONAL = ["@nestjs/microservices", "@nestjs/microservices/*", "class-transformer/storage", "pg-native"];

const external = [...OPTIONAL, ...KEEP.flatMap((p) => [p, `${p}/*`])];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const common = {
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  keepNames: true, // Nest relies on class names (providers, guards, DTO metadata)
  logLevel: "warning",
  external,
};
await esbuild.build({ ...common, entryPoints: [join(staged, "dist/src/main.js")], outfile: join(out, "dist/src/main.js") });
await esbuild.build({ ...common, entryPoints: [join(staged, "prisma/apply-migrations.js")], outfile: join(out, "prisma/apply-migrations.js") });
cpSync(join(staged, "prisma/migrations"), join(out, "prisma/migrations"), { recursive: true });
cpSync(join(staged, "prisma/schema.prisma"), join(out, "prisma/schema.prisma"));
cpSync(join(staged, "package.json"), join(out, "package.json"));

// Copy each kept package plus everything it depends on (hoisted layout).
const nm = join(staged, "node_modules");
const seen = new Set();
function keep(name) {
  if (seen.has(name)) return;
  const dir = join(nm, name);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return; // optional/missing peer
  seen.add(name);
  cpSync(dir, join(out, "node_modules", name), { recursive: true, dereference: true });
  const pkgFile = join(dir, "package.json");
  if (!existsSync(pkgFile)) return;
  const pkg = JSON.parse(readFileSync(pkgFile, "utf8"));
  for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) keep(dep);
}
KEEP.forEach(keep);

// The generated client (.prisma/client) carries its own PostgreSQL query
// compiler and loads only runtime/client.js from @prisma/client. The other
// runtimes and the per-database WASM engines (≈55 MB) are never loaded.
const runtime = join(out, "node_modules/@prisma/client/runtime");
for (const f of readdirSync(runtime)) {
  if (f === "client.js" || f.endsWith(".d.ts")) continue;
  if (/^(query_(engine|compiler)_bg\.|wasm-(engine|compiler)-edge|edge|react-native|library|index-browser|binary)/.test(f) || f.endsWith(".mjs")) {
    rmSync(join(runtime, f), { force: true });
  }
}

console.log(`bundled; kept packages: ${[...seen].sort().join(", ")}`);
