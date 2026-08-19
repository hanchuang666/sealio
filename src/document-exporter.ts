import type { PDFDocument as PdfDocument, PDFImage } from 'pdf-lib';
import { canvasToBytes, loadImage, releaseCanvas } from './media';
import { sealio } from './native';
import type { BlendModeKey, ExportFileType, LoadedDocument, StampAsset, StampPlacement } from './types';

const canvasBlendMap: Record<BlendModeKey, GlobalCompositeOperation> = {
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
};

const pdfBlendModeKeys: Partial<Record<BlendModeKey, 'Multiply' | 'Screen' | 'Overlay' | 'Darken' | 'Lighten'>> = {
  multiply: 'Multiply',
  screen: 'Screen',
  overlay: 'Overlay',
  darken: 'Darken',
  lighten: 'Lighten',
};

type PdfLibModule = typeof import('pdf-lib');

let pdfLibModulePromise: Promise<PdfLibModule> | null = null;

function getPdfLibModule() {
  if (!pdfLibModulePromise) pdfLibModulePromise = import('pdf-lib');
  return pdfLibModulePromise;
}

async function ensureStampBytes(stamp: StampAsset) {
  if (stamp.bytes.byteLength > 0) return stamp.bytes;
  if (!stamp.sourceUrl) throw new Error(`图章未加载：${stamp.originalName}`);
  const bytes = await sealio.readStamp({ id: stamp.id, storedPath: stamp.sourceUrl });
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

async function embedStamp(
  pdfDoc: PdfDocument,
  stamp: StampAsset,
  bytesCache: Map<string, Uint8Array>,
  imageCache: Map<string, PDFImage>,
) {
  const cachedImage = imageCache.get(stamp.id);
  if (cachedImage) return cachedImage;

  let stampBytes = bytesCache.get(stamp.id);
  if (!stampBytes) {
    stampBytes = await ensureStampBytes(stamp);
    bytesCache.set(stamp.id, stampBytes);
  }

  const embedded = stamp.mimeType === 'image/png' ? await pdfDoc.embedPng(stampBytes) : await pdfDoc.embedJpg(stampBytes);
  imageCache.set(stamp.id, embedded);
  return embedded;
}

async function exportPdf(documentFile: LoadedDocument, placements: StampPlacement[], stamps: StampAsset[]) {
  const { PDFDocument, BlendMode, degrees } = await getPdfLibModule();
  const pdfDoc = await PDFDocument.load(documentFile.bytes);
  const pages = pdfDoc.getPages();
  const stampById = new Map(stamps.map((stamp) => [stamp.id, stamp]));
  const stampBytesCache = new Map<string, Uint8Array>();
  const embeddedImageCache = new Map<string, PDFImage>();

  for (const placement of placements) {
    const page = pages[placement.pageNumber - 1];
    const renderedPage = documentFile.pages.find((item) => item.pageNumber === placement.pageNumber);
    const stamp = stampById.get(placement.stampId);
    if (!page || !renderedPage || !stamp) continue;

    const embedded = await embedStamp(pdfDoc, stamp, stampBytesCache, embeddedImageCache);
    const { width: pdfWidth, height: pdfHeight } = page.getSize();
    const x = (placement.x / renderedPage.width) * pdfWidth;
    const width = (placement.width / renderedPage.width) * pdfWidth;
    const height = (placement.height / renderedPage.height) * pdfHeight;
    const y = pdfHeight - ((placement.y / renderedPage.height) * pdfHeight + height);
    const blendModeKey = pdfBlendModeKeys[placement.blendMode];

    page.drawImage(embedded, {
      x,
      y,
      width,
      height,
      rotate: degrees(placement.rotation),
      opacity: placement.opacity,
      blendMode: blendModeKey ? BlendMode[blendModeKey] : undefined,
    });
  }

  return pdfDoc.save();
}

export async function exportDocumentAsPdf(
  documentFile: LoadedDocument,
  placements: StampPlacement[],
  stamps: StampAsset[],
) {
  if (documentFile.kind === 'pdf') return exportPdf(documentFile, placements, stamps);

  const { PDFDocument } = await getPdfLibModule();
  const page = documentFile.pages[0];
  if (!page) throw new Error('文件没有可导出的页面');
  const imageBytes = await exportPageAsImage(documentFile, placements, stamps, 1, 'image/png');
  const pdfDoc = await PDFDocument.create();
  const pdfPage = pdfDoc.addPage([page.width, page.height]);
  const image = await pdfDoc.embedPng(imageBytes);
  pdfPage.drawImage(image, { x: 0, y: 0, width: page.width, height: page.height });
  return pdfDoc.save();
}

export function exportDocumentAsImage(
  documentFile: LoadedDocument,
  placements: StampPlacement[],
  stamps: StampAsset[],
  fileType: ExportFileType,
  activePageNumber: number,
) {
  const pageNumber = documentFile.kind === 'pdf' ? activePageNumber : 1;
  const mimeType = fileType === 'png' ? 'image/png' : 'image/jpeg';
  return exportPageAsImage(documentFile, placements, stamps, pageNumber, mimeType);
}

async function exportPageAsImage(
  documentFile: LoadedDocument,
  placements: StampPlacement[],
  stamps: StampAsset[],
  pageNumber: number,
  mimeType: string,
) {
  const page = documentFile.pages.find((item) => item.pageNumber === pageNumber) ?? documentFile.pages[0];
  if (!page) throw new Error('文件没有可导出的页面');

  const source = await loadImage(page.dataUrl);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建图片导出画布');
  canvas.width = page.width;
  canvas.height = page.height;
  try {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, page.width, page.height);
    context.drawImage(source, 0, 0, page.width, page.height);

    const stampById = new Map(stamps.map((stamp) => [stamp.id, stamp]));
    const imageCache = new Map<string, HTMLImageElement>();
    for (const placement of placements) {
      if (placement.pageNumber !== page.pageNumber) continue;
      const stamp = stampById.get(placement.stampId);
      if (!stamp) continue;
      let image = imageCache.get(stamp.id);
      if (!image) {
        image = await loadImage(stamp.objectUrl);
        imageCache.set(stamp.id, image);
      }
      context.save();
      context.globalAlpha = placement.opacity;
      context.globalCompositeOperation = canvasBlendMap[placement.blendMode];
      context.translate(placement.x + placement.width / 2, placement.y + placement.height / 2);
      context.rotate((placement.rotation * Math.PI) / 180);
      context.drawImage(image, -placement.width / 2, -placement.height / 2, placement.width, placement.height);
      context.restore();
    }

    return await canvasToBytes(canvas, mimeType, mimeType === 'image/jpeg' ? 0.92 : undefined);
  } catch (error) {
    releaseCanvas(canvas);
    throw error;
  }
}
