import Markdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';

/** Markdown + KaTeX 渲染。不允许原始 HTML(react-markdown 默认忽略)。 */
export function MarkdownView({ children }: { children: string }) {
  return (
    <Markdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
      {children}
    </Markdown>
  );
}
