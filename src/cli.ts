/** CLI entry: `node dist/cli.cjs <command> ...` (or `npx tsx src/cli.ts` during development). */
import { run } from "./main.ts";

const code = run(process.argv.slice(2), {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  cwd: process.cwd(),
});
process.exitCode = code;
