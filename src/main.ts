import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { scan, type ScanOptions } from "./scan.ts";
import { InputError } from "./discover.ts";
import { formatText } from "./report.ts";

export const EXIT_OK = 0;
export const EXIT_ISSUES = 1;
export const EXIT_INPUT = 2;

const USAGE = `Usage:
  privacy-bundle-check scan <path> [--mode bundle|project] [--json] [--strict] [--no-external-tools]

  <path>              .app / .xcarchive / directory
  --mode bundle       default. Scan a built artifact
  --mode project      Walk source files and xcprivacy (for comparison)
  --json              Write JSON
  --strict            Also exit 1 on warnings
  --no-external-tools Use the built-in string extractor; do not call strings / nm

Exit codes: 0 = OK, 1 = missing / undeclared / duplicate (etc.), 2 = input error`;

export interface RunIO {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  cwd: string;
}

const defaultIO = (): RunIO => ({
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  cwd: process.cwd(),
});

export function run(argv: string[], io: RunIO = defaultIO()): number {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        json: { type: "boolean", default: false },
        mode: { type: "string", default: "bundle" },
        strict: { type: "boolean", default: false },
        "no-external-tools": { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
    });
  } catch (e) {
    io.stderr(`${(e as Error).message}\n\n${USAGE}\n`);
    return EXIT_INPUT;
  }
  const { values, positionals } = parsed;
  if (values.help) {
    io.stdout(USAGE + "\n");
    return EXIT_OK;
  }
  const [cmd, path, ...rest] = positionals;
  if (cmd !== "scan" || !path || rest.length > 0) {
    io.stderr(`${USAGE}\n`);
    return EXIT_INPUT;
  }
  if (values.mode !== "bundle" && values.mode !== "project") {
    io.stderr(`--mode must be bundle or project: ${values.mode}\n`);
    return EXIT_INPUT;
  }
  const input = resolve(io.cwd, path);
  const opts: ScanOptions = { mode: values.mode, externalTools: !values["no-external-tools"] };
  try {
    const result = scan(input, opts);
    // Keep the path the caller typed in the report
    result.input = path;
    io.stdout((values.json ? JSON.stringify(result, null, 2) : formatText(result)) + "\n");
    if (result.summary.errors > 0) return EXIT_ISSUES;
    if (values.strict && result.summary.warnings > 0) return EXIT_ISSUES;
    return EXIT_OK;
  } catch (e) {
    if (e instanceof InputError) {
      if (values.json) io.stdout(JSON.stringify({ input: path, error: e.message }, null, 2) + "\n");
      io.stderr(`入力エラー: ${e.message}\n`);
      return EXIT_INPUT;
    }
    throw e;
  }
}
