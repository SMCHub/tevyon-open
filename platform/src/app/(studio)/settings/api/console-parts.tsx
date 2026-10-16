"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";

/** Copies text, shows a check for a moment. The label names what is copied, for screen readers. */
export function CopyButton({ text, label, className = "" }: { text: string; label: string; className?: string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1600);
    } catch {
      // Clipboard blocked (insecure context, permissions): the text stays selectable.
    }
  }
  return (
    <button type="button" className={`ac-copy ${className}`} onClick={copy} aria-label={label} title={done ? "Kopiert" : label} data-done={done || undefined}>
      {done ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
    </button>
  );
}

type Token = { t: string; k?: "cmd" | "flag" | "str" | "url" | "sub" | "com" | "ph" | "key" | "punc" | "num" };

/** Monochrome syntax tint: commands bright, flags and punctuation quiet, placeholders dashed. Shell and JSON only. */
function tokenize(line: string, lang: "shell" | "json"): Token[] {
  const out: Token[] = [];
  if (lang === "shell" && /^\s*#/.test(line)) return [{ t: line, k: "com" }];
  const re = lang === "shell"
    ? /(\$\([^)]*\))|("[^"]*"|'[^']*')|(<[^>\s]+>)|(https?:\/\/[^\s"'\\]+)|((?:^|\s)--?[a-z][\w-]*)|(\S+)|(\s+)/g
    : /("[^"]*")(\s*:)?|([{}[\],])|(-?\d+(?:\.\d+)?)|(\s+)|([^\s"{}[\],]+)/g;
  let first = true;
  for (const m of line.matchAll(re)) {
    if (lang === "shell") {
      const [, sub, str, ph, url, flag, word, space] = m;
      if (sub) out.push({ t: sub, k: "sub" });
      else if (str) out.push({ t: str, k: str.includes("<") ? "ph" : "str" });
      else if (ph) out.push({ t: ph, k: "ph" });
      else if (url) out.push({ t: url, k: "url" });
      else if (flag) out.push({ t: flag, k: "flag" });
      else if (word) {
        out.push({ t: word, ...(first ? { k: "cmd" as const } : {}) });
        first = false;
        continue;
      } else if (space) out.push({ t: space });
      if (!space) first = false;
    } else {
      const [, str, colon, punc, num, space, rest] = m;
      if (str) {
        out.push({ t: str, k: colon ? "key" : str.includes("<") ? "ph" : "str" });
        if (colon) out.push({ t: colon, k: "punc" });
      } else if (punc) out.push({ t: punc, k: "punc" });
      else if (num) out.push({ t: num, k: "num" });
      else out.push({ t: space ?? rest ?? "" });
    }
  }
  return out;
}

/**
 * A code sample with a copy button. Shell lines get a quiet prompt that is not copied. `copy` is what the button
 * copies when it differs from what is shown (a secret shown masked but copied in full).
 */
export function CodeBlock({ code, copy, lang = "shell", label }: { code: string; copy?: string; lang?: "shell" | "json"; label: string }) {
  const lines = code.split("\n");
  return (
    <div className="ac-code" data-lang={lang}>
      <pre>
        <code>
          {lines.map((line, i) => (
            <span className="ac-code__line" key={i} data-cont={lang === "shell" && i > 0 && lines[i - 1]?.endsWith("\\") ? "" : undefined}>
              {tokenize(line, lang).map((tok, j) => (tok.k ? <span key={j} className={`tok-${tok.k}`}>{tok.t}</span> : tok.t))}
            </span>
          ))}
        </code>
      </pre>
      <CopyButton text={copy ?? code} label={label} />
    </div>
  );
}

/** A new key as it may be seen over a shoulder: the prefix and the last four characters. Copy buttons take the real one. */
export const maskKey = (key: string) => `${key.slice(0, 10)}${"•".repeat(22)}${key.slice(-4)}`;

const rtf = new Intl.RelativeTimeFormat("de-CH", { numeric: "auto", style: "short" });

export function relativeTime(ms: number, now = Date.now()): string {
  const s = Math.round((ms - now) / 1000);
  const abs = Math.abs(s);
  if (abs < 45) return "gerade eben";
  if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(s / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(s / 86400), "day");
  return new Date(ms).toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** «vor 3 Min.» that keeps itself current; the exact date sits in the title. Server and browser clocks may differ by a minute. */
export function RelativeTime({ ms }: { ms: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const exact = new Date(ms).toLocaleString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  return <time dateTime={new Date(ms).toISOString()} title={exact} suppressHydrationWarning>{relativeTime(ms, now)}</time>;
}

/** Credits spent in the last 24 hours against the key's limit. Without a limit, just the amount. */
export function UsageMeter({ spent, limit }: { spent: number; limit: number | null }) {
  const share = limit ? Math.min(1, spent / limit) : 0;
  const state = !limit ? "free" : share >= 1 ? "full" : share >= 0.8 ? "high" : "ok";
  return (
    <div className="ac-meter" data-state={state} title="Credits der letzten 24 Stunden">
      <div className="ac-meter__text">
        <strong>{spent.toLocaleString("de-CH")}</strong>
        <span>{limit ? ` / ${limit.toLocaleString("de-CH")} Credits` : " Credits · ohne Limit"}</span>
      </div>
      {limit ? (
        <div className="ac-meter__bar" role="meter" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={spent} aria-label="Verbrauch der letzten 24 Stunden">
          <span style={{ inlineSize: `${Math.max(share * 100, spent > 0 ? 3 : 0)}%` }} />
        </div>
      ) : null}
    </div>
  );
}
