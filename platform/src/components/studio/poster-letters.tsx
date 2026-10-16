import { splitTitle } from "./poster-type";
import "./poster-letters.css";

/**
 * A title as giant poster type: staggered rows of chunks (poster-type.ts). `--w` carries the widest row in em and
 * `--rows` the number of rows, so the place that shows it can fit the size to its box: `font-size: min(…, calc(<box
 * width> / var(--w)))`. Each chunk sits in its own mask with `--i` for a staggered rise. Decoration only: the title is
 * said elsewhere.
 */
export function PosterLetters({ title, className = "" }: { title: string; className?: string }) {
  const { rows, width } = splitTitle(title);
  let i = 0;
  return (
    <span className={`poster-letters${className ? ` ${className}` : ""}`} style={{ "--w": width, "--rows": rows.length } as React.CSSProperties} aria-hidden="true">
      {rows.map((row, r) => (
        <span key={r} className="poster-letters__row" style={{ "--o": `${row.indent}em` } as React.CSSProperties}>
          {row.chunks.map((c, k) => (
            <span key={k} className="poster-letters__chunk" style={{ "--i": i++ } as React.CSSProperties}>
              <span>{c}</span>
            </span>
          ))}
        </span>
      ))}
    </span>
  );
}
