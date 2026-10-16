import Link from "next/link";
import { ArrowRight } from "lucide-react";

/** Link button of the editorial pages: the label in an outlined pill, the arrow in its own pill beside it (fills on hover). */
export function XpLink({ href, children, className = "" }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <Link href={href} className={`xp-btn${className ? ` ${className}` : ""}`}>
      <span className="xp-btn__label">{children}</span>
      <span className="xp-btn__arrow" aria-hidden="true"><ArrowRight /></span>
    </Link>
  );
}

/** Lines of display type that rise out of their own mask once the block is in view (`.is-in` on an ancestor). */
export function Lines({ lines, muted = [] }: { lines: string[]; muted?: number[] }) {
  return (
    <>
      {lines.map((l, i) => (
        <span key={l} className={`xp-line${muted.includes(i) ? " xp-line--muted" : ""}`}>
          <span style={{ "--i": i } as React.CSSProperties}>{l}</span>
        </span>
      ))}
    </>
  );
}
