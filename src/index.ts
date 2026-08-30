#!/usr/bin/env bun

// @opentui/solid treats any DEBUG value as a reconciler trace switch.
// Keep normal application output clean unless UI tracing is explicitly requested.
if (!process.env.MINDS_DEBUG_UI) delete process.env.DEBUG;

await import("@opentui/solid/runtime-plugin-support");
const { runCli } = await import("./cli.ts");

try {
  process.exitCode = await runCli();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
