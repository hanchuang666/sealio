import { bytesToObjectUrl, canvasToBlob, loadImage, releaseCanvas, revokeObjectUrl } from './media';
import type { DocumentKind, PageRender } from './types';

type PdfJsModule = typeof import('pdfjs-dist');

let pdfJsModulePromise: Promise<PdfJsModule> | null = null;

function getPdfJsModule() {
  if (!pdfJsModulePromise) {
    pdfJsModulePromise = import('pdfjs-dist').then((module) => {
      module.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.js', import.meta.url).toString();
      return module;
    });
  }
  return pdfJsModulePromise;
}

async function renderPdfPages(bytes: Uint8Array): Promise<PageRender[]> {
  const pdfJsModule = await getPdfJsModule();
  const loadingTask = pdfJsModule.getDocument({ data: bytes.slice() });
  const pdf = await loadingTask.promise;
  const pages: PageRender[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1.35 });
      const canvas = document.createElement('canvas');

      try {
        const context = canvas.getContext('2d');
        if (!context) throw new Error('无法创建 PDF 渲染画布');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        await page.render({ canvasContext: context, viewport }).promise;
        const preview = await canvasToBlob(canvas, 'image/png');
        pages.push({
          pageNumber,
          width: canvas.width,
          height: canvas.height,
          dataUrl: URL.createObjectURL(preview),
        });
      } finally {
        page.cleanup();
        releaseCanvas(canvas);
      }
    }
    return pages;
  } catch (error) {
    pages.forEach((page) => revokeObjectUrl(page.dataUrl));
    throw error;
  } finally {
    await pdf.destroy();
  }
}

async function renderImagePage(bytes: Uint8Array, mimeType: string): Promise<PageRender[]> {
  const objectUrl = bytesToObjectUrl(bytes, mimeType);
  try {
    const image = await loadImage(objectUrl);
    const maxWidth = 900;
    const scale = Math.min(1, maxWidth / image.naturalWidth);
    return [
      {
        pageNumber: 1,
        width: Math.round(image.naturalWidth * scale),
        height: Math.round(image.naturalHeight * scale),
        dataUrl: objectUrl,
      },
    ];
  } catch (error) {
    revokeObjectUrl(objectUrl);
    throw error;
  }
}

export function renderDocumentPages(bytes: Uint8Array, kind: DocumentKind, mimeType: string) {
  return kind === 'pdf' ? renderPdfPages(bytes) : renderImagePage(bytes, mimeType);
}
