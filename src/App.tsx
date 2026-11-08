import Markdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { APP_DISPLAY_NAME } from './shared/app-info';

// 脚手架占位页:验证 React、Tailwind、Markdown + KaTeX 渲染链路。
const sample = '还剩 $24 - 24 \\times \\frac{1}{3} = 16$ 个苹果。';

export function App() {
  return (
    <main className="min-h-screen bg-indigo-50 p-8 text-slate-800">
      <h1 className="text-3xl font-bold">{APP_DISPLAY_NAME}</h1>
      <div className="mt-6 rounded-3xl bg-white p-6 shadow-lg">
        <Markdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
          {sample}
        </Markdown>
      </div>
    </main>
  );
}
