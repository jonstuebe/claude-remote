import { useEffect, useState } from "react";

/**
 * Returns true when the user's primary pointer is coarse (touch-first devices:
 * phones, tablets). Updates if the media query changes (e.g. plugging in a
 * mouse on a 2-in-1). Returns false during SSR / first paint.
 */
export function useIsTouch(): boolean {
  const [isTouch, setIsTouch] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia("(pointer: coarse)");
    setIsTouch(mql.matches);
    const handler = (event: MediaQueryListEvent) => setIsTouch(event.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  return isTouch;
}
