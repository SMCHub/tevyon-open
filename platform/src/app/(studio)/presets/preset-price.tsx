import { TokenGlyph } from "@/components/studio/tachyon-token";

/** A preset's price before the start. */
export function PresetPrice({ credits, className = "" }: { credits: number | null; className?: string }) {
  if (credits === null) return null;
  return (
    <span className={`ps-price${className ? ` ${className}` : ""}`} aria-label={`${credits} Credits`}>
      <TokenGlyph />
      {credits}
    </span>
  );
}
