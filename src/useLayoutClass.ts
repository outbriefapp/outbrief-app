import { type RefObject, useLayoutEffect, useState } from "react";
import { type LayoutClass, layoutClassOf } from "./layout.ts";

/**
 * 某个容器当前落在哪一档布局（YOUT-215）。量的是容器自己的宽度，不是 `window.innerWidth`：组件按
 * 自己拿到的宽度决定摆法，这样它嵌在哪儿都对（回放、分屏、以后可能的并排容器），也便于测试。
 * 用 ResizeObserver 而不是 matchMedia，理由相同。
 *
 * 折叠动作会让宽度在一帧内成倍变化，用 `useLayoutEffect` 在浏览器绘制前就量到，避免展开瞬间先闪
 * 一下旧布局。
 */
export function useLayoutClass(ref: RefObject<HTMLElement | null>): LayoutClass {
  const [layout, setLayout] = useState<LayoutClass>("compact");
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setLayout(layoutClassOf(el.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return layout;
}
