"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

/** Room kept free above the panel for the fixed header, and below it to the window edge. */
const TOP_GAP = 84;
const BOTTOM_GAP = 16;

/**
 * Small anchored popover: a trigger button and a panel that closes on outside click or Escape.
 * `side` decides whether the panel opens above (composer at the bottom) or below the trigger; "auto" opens above
 * when it fits there, otherwise on the side with more room, and caps the panel to that room (`--pop-max`).
 */
export function Popover({
  label,
  trigger,
  children,
  side = "top",
  align = "start",
  className = "",
  panelClassName = "",
}: {
  label: string;
  trigger: React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  side?: "top" | "bottom" | "auto";
  align?: "start" | "end";
  className?: string;
  panelClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<{ side: "top" | "bottom"; max: number; shift: number } | null>(null);

  // "auto": measured before the first paint, so the panel never shows on the wrong side or past the window edge.
  useLayoutEffect(() => {
    if (!open || side !== "auto") return;
    const t = root.current?.getBoundingClientRect();
    if (!t) return;
    const height = panel.current?.scrollHeight ?? 0;
    const width = panel.current?.offsetWidth ?? 0;
    const above = t.top - TOP_GAP;
    const below = window.innerHeight - t.bottom - BOTTOM_GAP;
    const s = height <= above || above >= below ? "top" : "bottom";
    // A start-aligned panel moves left as far as it would run past the right edge (phones), never past the left one.
    const shift = align === "start" ? Math.max(BOTTOM_GAP - t.left, Math.min(0, window.innerWidth - BOTTOM_GAP - (t.left + width))) : 0;
    setPlaced({ side: s, max: Math.max(160, Math.floor(s === "top" ? above : below)), shift: Math.round(shift) });
  }, [open, side, align]);
  const at = side === "auto" ? placed?.side ?? "top" : side;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={`pop ${className}`} ref={root}>
      <button type="button" className="pill-btn" aria-haspopup="dialog" aria-expanded={open} aria-label={label} onClick={() => { setPlaced(null); setOpen((o) => !o); }}>
        {trigger}
      </button>
      {open && (
        <div
          ref={panel}
          className={`pop__panel pop__panel--${at} pop__panel--${align} ${panelClassName}`}
          style={side === "auto" && placed ? ({ "--pop-max": `${placed.max}px`, ...(placed.shift ? { left: placed.shift } : {}) } as React.CSSProperties) : undefined}
          role="dialog"
          aria-label={label}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
