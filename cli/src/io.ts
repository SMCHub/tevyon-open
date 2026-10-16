import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import type { Io } from "./main.ts";
import { systemKeyStore } from "./store.ts";

/** The real world for main(): process streams, fetch, the keychain and the disk. */
export function realIo(): Io {
  return {
    argv: process.argv.slice(2),
    env: process.env,
    fetch: (input, init) => fetch(input, init),
    stdout: process.stdout,
    stderr: process.stderr,
    stdinIsTTY: Boolean(process.stdin.isTTY),
    async readStdin() {
      let text = "";
      for await (const chunk of process.stdin) text += String(chunk);
      return text;
    },
    ask(question, opts = {}) {
      return new Promise((resolve) => {
        const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
        if (opts.hidden) {
          // Echo nothing but the question itself, so a pasted key never shows on screen.
          const quiet = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WritableStream };
          quiet._writeToOutput = (s: string) => {
            if (s.includes(question)) quiet.output.write(question);
          };
        }
        rl.question(question, (answer) => {
          rl.close();
          if (opts.hidden) process.stderr.write("\n");
          resolve(answer);
        });
      });
    },
    store: systemKeyStore(process.env),
    openUrl: (url) =>
      new Promise<void>((resolve) => {
        const [cmd, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
        execFile(cmd, args as string[], () => resolve());
      }),
    hostname: () => hostname().replace(/\.local$/, ""),
    async writeFile(file, data) {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, data);
    },
    readFile: async (file) => new Uint8Array(await readFile(file)),
    cwd: process.cwd(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now(),
    uuid: () => randomUUID(),
  };
}
