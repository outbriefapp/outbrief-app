/** Which tabs a row shows, by index, and which go to the 更多 menu. */
export interface TabsFit {
  shown: number[];
  hidden: number[];
}

/**
 * Fits tabs of `widths` px into one row of `available` px, `gap` px apart. When they do not all
 * fit, the row keeps as many as fit in order next to the 更多 button (`moreWidth` px) and the rest go
 * to its menu; the `current` tab always stays in the row, in place of the last one that fit.
 */
export function fitTabs(
  widths: number[],
  available: number,
  gap: number,
  moreWidth: number,
  current: number,
): TabsFit {
  const all = widths.map((_, i) => i);
  const rowWidth = (indices: number[]) =>
    indices.reduce((sum, i) => sum + (widths[i] ?? 0), 0) + gap * Math.max(indices.length - 1, 0);
  if (rowWidth(all) <= available) return { shown: all, hidden: [] };

  const budget = available - moreWidth - gap;
  const shown: number[] = [];
  for (const i of all) {
    if (rowWidth([...shown, i]) > budget) break;
    shown.push(i);
  }
  if (current >= 0 && current < widths.length && !shown.includes(current)) {
    while (shown.length && rowWidth([...shown, current]) > budget) shown.pop();
    shown.push(current);
  }
  return { shown, hidden: all.filter((i) => !shown.includes(i)) };
}
