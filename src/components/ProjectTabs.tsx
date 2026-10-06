import { ChevronDown } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useT } from "../i18n/index.ts";
import { fitTabs, type TabsFit } from "../tabsFit.ts";
import { useDismiss } from "../useDismiss.ts";

export interface Tab {
  key: string;
  label: string;
  /** Missed calls: shown in red. */
  missed: number;
  /** Past calls: shown when there is no missed call. */
  past: number;
}

/** Touch screens scroll the row with a finger; a mouse gets the 更多 menu instead. */
function useCoarsePointer(): boolean {
  const query = "(pointer: coarse)";
  const [coarse, setCoarse] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const change = () => setCoarse(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  return coarse;
}

function TabLabel(props: { tab: Tab }) {
  const { tab } = props;
  return (
    <>
      <span className="tab-label">{tab.label}</span>
      {tab.missed > 0 ? (
        <span className="count missed">{tab.missed}</span>
      ) : (
        <span className="count">{tab.past}</span>
      )}
    </>
  );
}

/**
 * The project tabs of the calls screen, in one row. On a touch screen the row scrolls sideways with
 * a finger. With a mouse, tabs that do not fit go to a 更多 menu at the end of the row; the current
 * tab always stays in the row (YOUT-210).
 */
export function ProjectTabs(props: {
  tabs: Tab[];
  current: string;
  onSelect: (key: string) => void;
}) {
  const msg = useT();
  const coarse = useCoarsePointer();
  const { tabs, current } = props;
  const rowRef = useRef<HTMLElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<TabsFit | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const currentIndex = tabs.findIndex((t) => t.key === current);

  // Measures every tab in a hidden copy of the row, again whenever the row is resized.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure whenever the tabs change
  useLayoutEffect(() => {
    const row = rowRef.current;
    const measure = measureRef.current;
    if (coarse || !row || !measure) return;
    const update = () => {
      const items = [...measure.children] as HTMLElement[];
      const more = items.pop();
      const gap = Number.parseFloat(getComputedStyle(row).columnGap) || 0;
      const next = fitTabs(
        items.map((el) => el.offsetWidth),
        row.clientWidth,
        gap,
        more?.offsetWidth ?? 0,
        currentIndex,
      );
      setFit((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(row);
    return () => observer.disconnect();
  }, [coarse, tabs, currentIndex]);

  // The menu closes on a click anywhere else or on Escape.
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useDismiss(menuOpen, rowRef, closeMenu);

  // On a touch screen, the current tab scrolls into view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll whenever another tab is picked
  useEffect(() => {
    if (!coarse) return;
    rowRef.current
      ?.querySelector(".project-tab.current")
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [coarse, current]);

  const tabButton = (tab: Tab): ReactNode => (
    <button
      key={tab.key}
      type="button"
      className={tab.key === current ? "project-tab current" : "project-tab"}
      aria-pressed={tab.key === current}
      onClick={() => props.onSelect(tab.key)}
    >
      <TabLabel tab={tab} />
    </button>
  );

  if (coarse) {
    return (
      <nav ref={rowRef} className="project-tabs scroll" aria-label={msg.history.byProject}>
        {tabs.map(tabButton)}
      </nav>
    );
  }

  const at = (indices: number[]) => indices.flatMap((i) => tabs[i] ?? []);
  const shown = fit ? at(fit.shown) : tabs;
  const hidden = fit ? at(fit.hidden) : [];
  const hiddenMissed = hidden.reduce((sum, t) => sum + t.missed, 0);
  return (
    <nav ref={rowRef} className="project-tabs" aria-label={msg.history.byProject}>
      <div className="project-tabs-measure" aria-hidden>
        <div ref={measureRef}>
          {tabs.map((tab) => (
            <span key={tab.key} className="project-tab">
              <TabLabel tab={tab} />
            </span>
          ))}
          <span className="project-tab more">
            {msg.history.more}
            <span className="count missed">{tabs.length}</span>
            <ChevronDown size={14} />
          </span>
        </div>
      </div>
      {shown.map(tabButton)}
      {hidden.length > 0 && (
        <div className="more-tabs">
          <button
            type="button"
            className="project-tab more"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {msg.history.more}
            {hiddenMissed > 0 ? (
              <span className="count missed">{hiddenMissed}</span>
            ) : (
              <span className="count">{hidden.length}</span>
            )}
            <ChevronDown size={14} />
          </button>
          {menuOpen && (
            <div className="more-menu" role="menu">
              {hidden.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  role="menuitem"
                  className="more-menu-item"
                  onClick={() => {
                    setMenuOpen(false);
                    props.onSelect(tab.key);
                  }}
                >
                  <TabLabel tab={tab} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </nav>
  );
}
