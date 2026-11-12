import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** 渲染后长边的目标像素,与主进程规整图片的上限一致。 */
const TARGET_EDGE = 2000;

export class PdfError extends Error {}

/**
 * 把 PDF 的每一页渲染成 JPEG 字节,交给主进程当普通图片导入。
 * 页数超过 maxPages 时不渲染,直接报错(让家长分次提交,不悄悄丢页)。
 */
export async function renderPdfPages(
  bytes: Uint8Array,
  maxPages: number,
  onProgress?: (done: number, total: number) => void,
): Promise<Uint8Array[]> {
  // pdf.js 会接管传入的缓冲区,所以交一份拷贝。
  const task = pdfjs.getDocument({ data: bytes.slice() });
  let doc: pdfjs.PDFDocumentProxy;
  try {
    doc = await task.promise;
  } catch {
    void task.destroy();
    throw new PdfError('这个 PDF 打不开,可能已损坏或设置了密码');
  }
  try {
    if (doc.numPages > maxPages) {
      throw new PdfError(
        `这个 PDF 有 ${doc.numPages} 页,一份试卷最多 ${maxPages} 页,请拆开分次提交`,
      );
    }
    const pages: Uint8Array[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const scale = TARGET_EDGE / Math.max(base.width, base.height);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await page.render({ canvas, viewport }).promise;
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', 0.85),
      );
      page.cleanup();
      if (!blob) throw new PdfError('PDF 第 ' + i + ' 页转换失败');
      pages.push(new Uint8Array(await blob.arrayBuffer()));
      onProgress?.(i, doc.numPages);
    }
    return pages;
  } finally {
    void task.destroy();
  }
}
