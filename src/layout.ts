/**
 * 宽屏布局判定（YOUT-215）。
 *
 * 折叠屏展开／折起时窗口宽度会在一瞬间成倍变化：阔折叠（Honor Magic V3 等）外屏约 353×792 CSS px，
 * 展开内屏约 781×719。这些数字都是「物理分辨率 ÷ 设备像素比」，所以判定只看 CSS 像素宽度，
 * 不看物理分辨率 —— 同一块物理屏在不同 DPR 下 CSS 宽度不同，按物理分辨率判会判错。
 *
 * 断点沿用 Material 3 的 window size class（compact / medium / expanded），不自造一套：安卓折叠屏
 * 生态、Jetpack WindowManager 和各家厂商的多窗口规则都按这三档分，跟着它走，展开后的表现和系统级
 * 分屏一致。
 *
 * 非折叠屏手机的 CSS 宽度都在 600 以下（iPhone SE 320、安卓主流 360、iPhone 15 393、15 Pro Max
 * 430），天然落在 compact 单栏，所以「普通手机 = 折叠屏折起来的样子」是同一条代码路径，不需要
 * 为普通手机写任何特例。阔折叠外屏 353 也在这一档。
 *
 * 铰链（折痕）位置用 W3C Viewport Segments 的 `horizontal-viewport-segments` 媒体查询读，
 * 见 `styles.css` 里的 `.call-wide`：内容避开折痕这件事浏览器已经暴露了标准能力，不用猜屏幕中线。
 */

/**
 * Material 3 的 window size class。通话页只有两种摆法：compact 单栏（手机、折叠屏外屏、默认宽度的
 * 桌面窗口）；medium / expanded 都是「通话 + 原文」两栏，区别只在两栏怎么分宽度 —— medium
 * （折叠屏内屏）左右对半、各占一块屏；expanded（拉宽的 PC 窗口）左栏定宽、多出来的都给原文。
 */
export type LayoutClass = "compact" | "medium" | "expanded";

/** Material 3 断点（CSS px）：< 600 compact，600–839 medium，≥ 840 expanded。 */
export const MEDIUM_MIN = 600;
export const EXPANDED_MIN = 840;

/**
 * 宽度落在哪一档。`width` 是 CSS 像素宽度，由组件量自己容器的宽度得来（不是 `window.innerWidth`）。
 *
 * 判定只看宽度，所以 iPad mini 竖屏 744、iPad Pro 11 竖屏 834 会落到 medium，也就是平板会分栏。
 * 这是有意的：平板确实放得下两栏。要让平板保持单栏就不能只看宽度，得再结合 `pointer: coarse`
 * 之类的条件 —— 那会让「同一个宽度在不同设备上摆法不同」，这里不做。
 */
export function layoutClassOf(width: number): LayoutClass {
  if (width >= EXPANDED_MIN) return "expanded";
  if (width >= MEDIUM_MIN) return "medium";
  return "compact";
}

/** 这一档是否并排显示两栏（通话界面 + 汇报原文）。 */
export function isTwoPane(layout: LayoutClass): boolean {
  return layout !== "compact";
}

/**
 * 通话页这一档摆几栏。左栏（折起时那一整套通话界面）永远有；右栏是汇报原文，只在宽屏出现。
 *
 * `cardShowsRaw` 为真时不出右栏：简报生成失败的降级分支里卡片放的就是原文（`session.ts`），
 * 右栏再放一遍是同一段文字两份。
 */
export function callPanes(
  layout: LayoutClass,
  cardShowsRaw: boolean,
): { stage: true; raw: boolean } {
  return { stage: true, raw: isTwoPane(layout) && !cardShowsRaw };
}
