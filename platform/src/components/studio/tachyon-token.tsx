import { useId } from "react";

/**
 * The Tevyon symbol (prototype/assets/brand/tevyon-mark.svg): the T of the wordmark, its left arm running out as the
 * light trail, the dot ahead as the particle, everything at the logo's one 10° slant. Centred in the 1290 × 815 box
 * the callers have always used; the path is `mark1290` from tevyon-logo.json (build-logo.py).
 */
export function Mark() {
  return (
    <>
      <path d="M134.9 10.4L907.3 10.4L876.8 183.4L761 183.4L649.6 815L456.5 815L567.9 183.4Q429.3 34.6 134.9 10.4Z" />
      <circle cx="1058.2" cy="96.9" r="96.9" />
    </>
  );
}

/**
 * The Tachyon token: the credit as a minted coin with the T, in the brand's own colours (no accent): a Photon chrome
 * face that falls off to Ash, a glass rim (bright on top, Graphite below), an inner ring, the mark in Void.
 */
export function TachyonToken({ size = 22 }: { size?: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg className="tachyon-token" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}f`} x1="0.2" y1="0" x2="0.75" y2="1">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="0.42" stopColor="#E7E7E3" />
          <stop offset="0.78" stopColor="#B4B4B9" />
          <stop offset="1" stopColor="#86868C" />
        </linearGradient>
        <radialGradient id={`${id}g`} cx="30%" cy="22%" r="55%">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.9" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}r`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="0.5" stopColor="#D6D6D3" stopOpacity="0.4" />
          <stop offset="1" stopColor="#2A2A2D" />
        </linearGradient>
      </defs>
      <circle cx="12" cy="12" r="11.5" fill={`url(#${id}f)`} />
      <circle cx="12" cy="12" r="11.5" fill={`url(#${id}g)`} />
      <circle cx="12" cy="12" r="11.05" fill="none" stroke={`url(#${id}r)`} strokeWidth="0.9" />
      <circle cx="12" cy="12" r="9.1" fill="none" stroke="#0A0A0B" strokeOpacity="0.16" strokeWidth="0.55" />
      <g transform="translate(5.3 8.1) scale(0.0104)" fill="#0A0A0B">
        <Mark />
      </g>
    </svg>
  );
}

/** One-colour token for price chips and inline amounts: ring plus T in currentColor, sized like the icons around it. */
export function TokenGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="10.2" fill="none" stroke="currentColor" strokeWidth="1.9" />
      <g transform="translate(5.9 8.4) scale(0.0094)" fill="currentColor">
        <Mark />
      </g>
    </svg>
  );
}
