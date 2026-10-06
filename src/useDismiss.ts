import { type RefObject, useEffect } from "react";

/** While `open`, a click outside `ref` or Escape calls `close` (menus and popovers). */
export function useDismiss(open: boolean, ref: RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const dismiss = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (e instanceof MouseEvent && ref.current?.contains(e.target as Node)) return;
      close();
    };
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", dismiss);
    return () => {
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("keydown", dismiss);
    };
  }, [open, ref, close]);
}
