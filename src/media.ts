import type { LoadedDocument, StampAsset } from './types';

export function bytesToObjectUrl(bytes: Uint8Array, mimeType: string) {
  const copy = new Uint8Array(bytes);
  return URL.createObjectURL(new Blob([copy.buffer], { type: mimeType }));
}

export function revokeObjectUrl(url: string) {
  if (url.startsWith('blob:')) URL.revokeObjectURL(url);
}

export function releaseDocumentResources(documentFile: LoadedDocument) {
  documentFile.pages.forEach((page) => revokeObjectUrl(page.dataUrl));
}

export function releaseStampResources(stamp: StampAsset) {
  revokeObjectUrl(stamp.objectUrl);
}

export function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片加载失败'));
    image.src = src;
  });
}

export function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('画布编码失败'))), mimeType, quality);
  });
}

export function releaseCanvas(canvas: HTMLCanvasElement) {
  canvas.width = 0;
  canvas.height = 0;
}

export async function canvasToBytes(canvas: HTMLCanvasElement, mimeType: string, quality?: number) {
  try {
    const blob = await canvasToBlob(canvas, mimeType, quality);
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    releaseCanvas(canvas);
  }
}

export function canvasToPngBytes(canvas: HTMLCanvasElement) {
  return canvasToBytes(canvas, 'image/png');
}
