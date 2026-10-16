import { Fragment, type ReactNode } from "react";
import { parseMarkdown, type Inline } from "@/lib/markdown";

function inline(nodes: Inline[]): ReactNode {
  return nodes.map((n, i) =>
    n.t === "text" ? <Fragment key={i}>{n.v}</Fragment>
    : n.t === "code" ? <code key={i}>{n.v}</code>
    : n.t === "strong" ? <strong key={i}>{inline(n.c)}</strong>
    : <em key={i}>{inline(n.c)}</em>,
  );
}

const lines = (ls: Inline[][], tail: ReactNode) => ls.map((l, i) => (
  <Fragment key={i}>{i > 0 && <br />}{inline(l)}{i === ls.length - 1 && tail}</Fragment>
));

/** A chat answer as text nodes (see lib/markdown); `tail` (a caret while it streams) follows the last word. */
export function MarkdownView({ text, tail, className }: { text: string; tail?: ReactNode; className?: string }) {
  const blocks = parseMarkdown(text);
  return (
    <div className={className ? `md ${className}` : "md"}>
      {blocks.map((b, i) => {
        const t = i === blocks.length - 1 ? tail : null;
        if (b.t === "p") return <p key={i}>{lines(b.lines, t)}</p>;
        if (b.t === "quote") return <blockquote key={i}>{lines(b.lines, t)}</blockquote>;
        if (b.t === "h") return <h4 key={i}>{inline(b.c)}{t}</h4>;
        const items = b.items.map((it, j) => <li key={j}>{inline(it)}{j === b.items.length - 1 && t}</li>);
        return b.t === "ul" ? <ul key={i}>{items}</ul> : <ol key={i} start={b.start}>{items}</ol>;
      })}
      {!blocks.length && tail}
    </div>
  );
}
