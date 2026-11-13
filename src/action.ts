/**
 * GitHub Action entry. Reads INPUT_* env vars set by the runner,
 * runs `scan`, writes the exit-code output, and exits with that code.
 */
import { appendFileSync } from "node:fs";
import { EXIT_INPUT, EXIT_ISSUES, run } from "./main.ts";

function main(): void {
  const path = process.env.INPUT_PATH ?? "";
  const mode = process.env.INPUT_MODE || "bundle";
  const strict = (process.env.INPUT_STRICT ?? "false").toLowerCase() === "true";

  const args = ["scan", path, "--mode", mode];
  if (strict) args.push("--strict");

  const code = run(args, {
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
    cwd: process.env.GITHUB_WORKSPACE || process.cwd(),
  });

  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    appendFileSync(outputFile, `exit-code=${code}\n`);
  }

  if (code === EXIT_ISSUES) {
    process.stdout.write("::error::privacy-bundle-check: missing, undeclared, or duplicate Privacy Manifest findings\n");
  } else if (code === EXIT_INPUT) {
    process.stdout.write("::error::privacy-bundle-check: input error (missing path, etc.)\n");
  }

  process.exit(code);
}

main();
