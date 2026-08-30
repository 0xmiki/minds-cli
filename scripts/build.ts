import { chmod, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import solidPlugin from "@opentui/solid/bun-plugin";

const root = resolve(import.meta.dir, "..");
const output = join(root, "dist");

await rm(output, { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: [join(root, "src/index.ts")],
  outdir: output,
  target: "bun",
  format: "esm",
  packages: "external",
  plugins: [solidPlugin],
  sourcemap: "external",
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

const executable = join(output, "index.js");
const application = join(output, "app.js");
const bundled = await readFile(executable, "utf8");
await writeFile(application, bundled.replace(/^#![^\n]*\n/, ""));
await writeFile(executable, `#!/usr/bin/env bun
await import("@opentui/solid/preload");
await import("./app.js");
`);
await chmod(executable, 0o755);

const binDirectory = join(root, "node_modules/.bin");
const localBin = join(binDirectory, "minds");
await mkdir(binDirectory, { recursive: true });
await rm(localBin, { force: true });
await symlink("../../dist/index.js", localBin);
