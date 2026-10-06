import { ChevronLeft } from "lucide-react";
import { useT } from "../i18n/index.ts";

/** The ‹ at the top left of every sub-page: only the symbol, the words are for screen readers. */
export function BackButton(props: { label?: string; onClick: () => void }) {
  const msg = useT();
  const label = props.label ?? msg.common.back;
  return (
    <button
      type="button"
      className="link back"
      aria-label={label}
      title={label}
      onClick={props.onClick}
    >
      <ChevronLeft size={22} aria-hidden />
    </button>
  );
}
