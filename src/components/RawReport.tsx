import { useT } from "../i18n/index.ts";

/**
 * 汇报原文，宽屏下常驻右栏（YOUT-215）。
 *
 * 原文是通话里唯一「有数据但看不到」的东西：提问时它完整不截断送给大模型（`src/llm/qa.ts`），
 * 界面上却只在简报生成失败的降级分支里显示（`src/call/session.ts` 的 `body: event.content`）。
 * 阔折叠展开后宽 +428px 但高 −73px，多出来的只有宽度，正好放这段整篇文字。
 *
 * 不做「跟着播放高亮正在讲的那一节」：真实协议里没有「简报段落 → 原文位置」的对应关系
 * （`BriefSegment.coveredFactIds` 只把段落连到关键事实，没连回原文位置），要做得先改 daemon 的
 * 简报生成。所以这里是静态原文，不猜位置 —— 猜错的高亮比没有高亮更误导。
 */
export function RawReport(props: { content: string }) {
  const msg = useT();
  return (
    <section className="raw-column" aria-label={msg.call.rawReport}>
      <h2 className="pane-title">{msg.call.rawReport}</h2>
      <pre className="raw-body">{props.content}</pre>
    </section>
  );
}
