"use client";

import { useEffect, useRef, useState } from "react";

/**
 * True once the element has come into view, and it stays true: for reveals that play once. `always` is true while the
 * element is on screen and false again when it leaves (for timers that should only run where somebody looks).
 */
export function useInView<T extends Element>({ once = true, rootMargin = "0px 0px -12% 0px" }: { once?: boolean; rootMargin?: string } = {}) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        const on = !!e?.isIntersecting;
        if (once && !on) return;
        setInView(on);
        if (once) io.disconnect();
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [once, rootMargin]);
  return [ref, inView] as const;
}
