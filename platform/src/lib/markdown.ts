/**
 * The small part of Markdown that chat answers use: paragraphs, headings, lists, quotes, bold, emphasis and code.
 * It returns a tree, never HTML, so the page renders it as text nodes: no links, no images, nothing a model could
 * smuggle into the page. Markers that are not closed stay text, which keeps a half-streamed answer readable.
 */
export type Inline = { t: "text"; v: string } | { t: "strong"; c: Inline[] } | { t: "em"; c: Inline[] } | { t: "code"; v: string };
export type Block =
  | { t: "p"; lines: Inline[][] }
  | { t: "h"; c: Inline[] }
  | { t: "quote"; lines: Inline[][] }
  | { t: "ul"; items: Inline[][] }
  | { t: "ol"; start: number; items: Inline[][] };

const TOKEN = /(`[^`\n]+`|\*\*(?=\S)[^\n]*?\S\*\*(?!\*)|__(?=\S)[^\n]*?\S__(?!_)|\*(?=[^\s*])[^*\n]*?[^\s*]\*|\*[^\s*]\*)/;

export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  const push = (v: string) => {
    if (!v) return;
    const prev = out.at(-1);
    if (prev?.t === "text") prev.v += v;
    else out.push({ t: "text", v });
  };
  let rest = s;
  while (rest) {
    const m = TOKEN.exec(rest);
    if (!m) {
      push(rest);
      break;
    }
    push(rest.slice(0, m.index));
    const tok = m[0];
    if (tok.startsWith("`")) out.push({ t: "code", v: tok.slice(1, -1) });
    else if (tok.startsWith("**") || tok.startsWith("__")) out.push({ t: "strong", c: parseInline(tok.slice(2, -2)) });
    else out.push({ t: "em", c: parseInline(tok.slice(1, -1)) });
    rest = rest.slice(m.index + tok.length);
  }
  return out;
}

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBER = /^\s*(\d{1,3})[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;

export function parseMarkdown(text: string): Block[] {
  const blocks: Block[] = [];
  const last = () => blocks.at(-1);
  let open = false; // whether the next plain line continues the last paragraph or quote
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      open = false;
      continue;
    }
    let m: RegExpExecArray | null;
    if ((m = HEADING.exec(line))) {
      blocks.push({ t: "h", c: parseInline(m[1]!.replace(/\s*#+$/, "")) });
      open = false;
    } else if ((m = BULLET.exec(line))) {
      const b = last();
      if (b?.t === "ul") b.items.push(parseInline(m[1]!));
      else blocks.push({ t: "ul", items: [parseInline(m[1]!)] });
      open = false;
    } else if ((m = NUMBER.exec(line))) {
      const b = last();
      if (b?.t === "ol") b.items.push(parseInline(m[2]!));
      else blocks.push({ t: "ol", start: Number(m[1]), items: [parseInline(m[2]!)] });
      open = false;
    } else if ((m = QUOTE.exec(line))) {
      const b = last();
      if (open && b?.t === "quote") b.lines.push(parseInline(m[1]!));
      else blocks.push({ t: "quote", lines: [parseInline(m[1]!)] });
      open = true;
    } else {
      const b = last();
      if (open && b?.t === "p") b.lines.push(parseInline(line.trim()));
      else blocks.push({ t: "p", lines: [parseInline(line.trim())] });
      open = true;
    }
  }
  return blocks;
}
