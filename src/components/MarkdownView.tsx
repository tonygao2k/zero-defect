import Markdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';

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
      {children}
    </Markdown>
  );
}
