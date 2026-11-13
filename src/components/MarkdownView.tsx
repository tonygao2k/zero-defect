import Markdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';

/**
 * 模型常把填空方框写成 Unicode 的 □(U+25A1),KaTeX 不认识,会反复警告。
 * 公式里换成 \square;公式外换成行内公式 $\square$,两处显示一致。
 */
export function normalizeSquares(text: string): string {
  if (!text.includes('□')) return text;
  return text
    .split(/(\$\$[\s\S]*?\$\$|\$[^$\n]*?\$)/g)
    .map((part, i) =>
      i % 2 === 1
        ? part.replaceAll('□', '\\square ')
        : part.replaceAll('□', '$\\square$'),
    )
    .join('');
}

/**
 * Markdown + KaTeX 渲染。不允许原始 HTML(react-markdown 默认忽略)。
 * inline 为 true 时不生成段落块,可以放进按钮、列表行等一行的位置。
 */
export function MarkdownView({
  children,
  inline = false,
}: {
  children: string;
  inline?: boolean;
}) {
  return (
    <Markdown
      remarkPlugins={[remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={
        inline ? { p: ({ children: c }) => <span>{c}</span> } : undefined
      }
    >
      {normalizeSquares(children)}
    </Markdown>
  );
}
