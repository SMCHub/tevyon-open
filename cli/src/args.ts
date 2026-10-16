/**
 * A small argv parser. Flags are --name value, --name=value, --flag, --no-flag. Which flags stand alone (booleans)
 * must be known up front, so that "--yes a fox" does not read "a fox" as the value of --yes.
 */
export type Parsed = {
  positionals: string[];
  /** Flag name (as typed, kebab-case) → value. Booleans are true/false; --no-x is x=false. */
  flags: Map<string, string | boolean>;
};

const BOOL_WORDS: Record<string, boolean> = { true: true, false: false, yes: true, no: false, ja: true, nein: false, "1": true, "0": false };

export function parseArgs(argv: string[], isBoolean: (name: string) => boolean): Parsed | { error: "missing_value"; name: string } {
  const positionals: string[] = [];
  const flags = new Map<string, string | boolean>();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] ?? "";
    if (token === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (token === "-h") {
      flags.set("help", true);
      continue;
    }
    if (token === "-v") {
      flags.set("version", true);
      continue;
    }
    if (!token.startsWith("--") || token === "--") {
      positionals.push(token);
      continue;
    }
    const body = token.slice(2);
    const eq = body.indexOf("=");
    if (eq >= 0) {
      const name = body.slice(0, eq);
      const raw = body.slice(eq + 1);
      flags.set(name, isBoolean(name) && raw.toLowerCase() in BOOL_WORDS ? BOOL_WORDS[raw.toLowerCase()]! : raw);
      continue;
    }
    if (body.startsWith("no-") && isBoolean(body.slice(3))) {
      flags.set(body.slice(3), false);
      continue;
    }
    if (isBoolean(body)) {
      // An explicit yes/no right after a boolean flag belongs to it ("--generate-audio false").
      const next = argv[i + 1]?.toLowerCase();
      if (next !== undefined && next in BOOL_WORDS) {
        flags.set(body, BOOL_WORDS[next]!);
        i++;
      } else {
        flags.set(body, true);
      }
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) return { error: "missing_value", name: body };
    flags.set(body, value);
    i++;
  }
  return { positionals, flags };
}
