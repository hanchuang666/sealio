import React from 'react';
import ReactDOM from 'react-dom/client';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, BlendMode, degrees } from 'pdf-lib';
import { sealio } from './native';
import './styles.css';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.js',
  import.meta.url,
).toString();

type DocumentKind = 'pdf' | 'image';
type BlendModeKey = 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten';
type PageViewMode = 'single' | 'multi';
type StampHistoryView = 'list' | 'card';
type ExportFileType = 'pdf' | 'png' | 'jpg' | 'jpeg';

type LoadedDocument = {
  id: string;
  name: string;
  path: string;
  ext: string;
  kind: DocumentKind;
  bytes: Uint8Array;
  pages: PageRender[];
};

type PageRender = {
  pageNumber: number;
  width: number;
  height: number;
  dataUrl: string;
};

type StampAsset = {
  id: string;
  originalName: string;
  mimeType: string;
  bytes: Uint8Array;
  objectUrl: string;
  isDerived?: boolean;
};

type StampPlacement = {
  id: string;
  documentId: string;
  stampId: string;
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  blendMode: BlendModeKey;
};

type PlacementContextMenu = {
  x: number;
  y: number;
  placementId: string;
};

type StampPointerDrag = {
  stampId: string;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  dragging: boolean;
};

type DocumentTabDrag = {
  documentId: string;
  startX: number;
  startY: number;
  dragging: boolean;
};

const blendModeLabels: Record<BlendModeKey, string> = {
  normal: '正常',
  multiply: '正片叠底',
  screen: '滤色',
  overlay: '叠加',
  darken: '变暗',
  lighten: '变亮',
};

const canvasBlendMap: Record<BlendModeKey, GlobalCompositeOperation> = {
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
};

const pdfBlendMap: Partial<Record<BlendModeKey, BlendMode>> = {
  multiply: BlendMode.Multiply,
  screen: BlendMode.Screen,
  overlay: BlendMode.Overlay,
  darken: BlendMode.Darken,
  lighten: BlendMode.Lighten,
};

const DEFAULT_STAMP_SIZE = 150;
const SEAM_STAMP_DEFAULT_ROTATION = 0;
const ZOOM_MIN_PERCENT = 20;
const ZOOM_MAX_PERCENT = 200;
const exportFileTypes: ExportFileType[] = ['pdf', 'png', 'jpg', 'jpeg'];

function IconOpenFile() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 6.5h6.2l1.8 2H20v9.8a1.7 1.7 0 0 1-1.7 1.7H5.7A1.7 1.7 0 0 1 4 18.3Z" />
      <path d="M4 8.5V5.7A1.7 1.7 0 0 1 5.7 4h4.1l1.8 2H18" />
      <path d="M12 12v5" />
      <path d="M9.5 14.5 12 12l2.5 2.5" />
    </svg>
  );
}

function IconExportFile() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4v10" />
      <path d="M8.5 7.5 12 4l3.5 3.5" />
      <path d="M5 14.5v3.8A1.7 1.7 0 0 0 6.7 20h10.6a1.7 1.7 0 0 0 1.7-1.7v-3.8" />
    </svg>
  );
}

function clampZoomPercent(value: number) {
  if (!Number.isFinite(value)) return 100;
  return Math.min(ZOOM_MAX_PERCENT, Math.max(ZOOM_MIN_PERCENT, Math.round(value)));
}

function toUint8Array(bytes: number[]) {
  return new Uint8Array(bytes);
}

function bytesToObjectUrl(bytes: Uint8Array, mimeType: string) {
  const copy = new Uint8Array(bytes);
  return URL.createObjectURL(new Blob([copy.buffer], { type: mimeType }));
}

function extensionToMime(ext: string) {
  return ext === 'png' ? 'image/png' : 'image/jpeg';
}

function downloadName(name: string, ext: string) {
  const base = name.replace(/\.[^.]+$/, '');
  return `${base}_stamped.${ext}`;
}

function defaultExportFileType(documentFile: LoadedDocument): ExportFileType {
  const ext = documentFile.ext.toLowerCase();
  if (exportFileTypes.includes(ext as ExportFileType)) return ext as ExportFileType;
  return documentFile.kind === 'pdf' ? 'pdf' : 'png';
}

function exportFileTypeFromPath(path: string): ExportFileType | null {
  const match = path.toLowerCase().match(/\.([a-z0-9]+)$/);
  if (!match) return null;
  const ext = match[1];
  return exportFileTypes.includes(ext as ExportFileType) ? (ext as ExportFileType) : null;
}

function ensureExportPathExtension(path: string, fileType: ExportFileType) {
  return exportFileTypeFromPath(path) ? path : `${path}.${fileType}`;
}

function imageMimeForExport(fileType: ExportFileType) {
  return fileType === 'png' ? 'image/png' : 'image/jpeg';
}

function displayNameWithoutExtension(name: string) {
  return name.replace(/\.[^/.]+$/, '');
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let size = bytes / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size >= 10 ? size.toFixed(1) : size.toFixed(2)} ${units[unitIndex]}`;
}

async function renderPdfPages(bytes: Uint8Array): Promise<PageRender[]> {
  const loadingTask = pdfjsLib.getDocument({ data: bytes.slice() });
  const pdf = await loadingTask.promise;
  const pages: PageRender[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.35 });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法创建 PDF 渲染画布');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvasContext: context, viewport }).promise;
    pages.push({
      pageNumber,
      width: canvas.width,
      height: canvas.height,
      dataUrl: canvas.toDataURL('image/png'),
    });
  }

  return pages;
}

async function renderImagePage(bytes: Uint8Array, mimeType: string): Promise<PageRender[]> {
  const objectUrl = bytesToObjectUrl(bytes, mimeType);
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
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

async function encodeCanvasBytes(canvas: HTMLCanvasElement, mimeType: string) {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('导出图片失败'))), mimeType, 0.92);
  });
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
}

async function canvasToPngBytes(canvas: HTMLCanvasElement) {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('图章切割失败'))), 'image/png');
  });
  return new Uint8Array(await blob.arrayBuffer());
}

function App() {
  const [documents, setDocuments] = React.useState<LoadedDocument[]>([]);
  const [activeDocumentId, setActiveDocumentId] = React.useState<string | null>(null);
  const [dirtyDocumentIds, setDirtyDocumentIds] = React.useState<Set<string>>(() => new Set());
  const [stamps, setStamps] = React.useState<StampAsset[]>([]);
  const [placements, setPlacements] = React.useState<StampPlacement[]>([]);
  const [selectedStampId, setSelectedStampId] = React.useState<string | null>(null);
  const [selectedPlacementId, setSelectedPlacementId] = React.useState<string | null>(null);
  const [pageViewMode, setPageViewMode] = React.useState<PageViewMode>('multi');
  const [activePageNumber, setActivePageNumber] = React.useState(1);
  const [stampHistoryView, setStampHistoryView] = React.useState<StampHistoryView>('list');
  const [isStampManagerOpen, setIsStampManagerOpen] = React.useState(false);
  const [zoom, setZoom] = React.useState(0.92);
  const [zoomInputValue, setZoomInputValue] = React.useState('92');
  const [isExporting, setIsExporting] = React.useState(false);
  const [status, setStatus] = React.useState('准备就绪');
  const [dragOverPage, setDragOverPage] = React.useState<number | null>(null);
  const [stampDragPreview, setStampDragPreview] = React.useState<{ stampId: string; x: number; y: number } | null>(null);
  const [draggingDocumentId, setDraggingDocumentId] = React.useState<string | null>(null);
  const [placementContextMenu, setPlacementContextMenu] = React.useState<PlacementContextMenu | null>(null);
  const fileTabsRef = React.useRef<HTMLElement | null>(null);
  const documentTabRefs = React.useRef<Record<string, HTMLDivElement | null>>({});
  const canvasAreaRef = React.useRef<HTMLElement | null>(null);
  const pageElementRefs = React.useRef<Record<number, HTMLDivElement | null>>({});
  const pageThumbRefs = React.useRef<Record<number, HTMLButtonElement | null>>({});
  const pendingScrollPageRef = React.useRef<number | null>(null);
  const editorScrollFrame = React.useRef<number | null>(null);
  const stampPointerDrag = React.useRef<StampPointerDrag | null>(null);
  const documentTabDrag = React.useRef<DocumentTabDrag | null>(null);
  const suppressNextTabClick = React.useRef(false);
  const pointerAction = React.useRef<
    | { kind: 'move'; id: string; startX: number; startY: number; originX: number; originY: number }
    | {
        kind: 'resize';
        id: string;
        startX: number;
        startY: number;
        originWidth: number;
        originHeight: number;
      }
    | { kind: 'rotate'; id: string; centerX: number; centerY: number; originRotation: number; startAngle: number }
    | null
  >(null);

  React.useEffect(() => {
    sealio.listStamps().then((items) => {
      const loaded = items.map((item) => ({
        id: item.id,
        originalName: item.originalName,
        mimeType: item.mimeType,
        bytes: toUint8Array(item.bytes),
        objectUrl: bytesToObjectUrl(toUint8Array(item.bytes), item.mimeType),
      }));
      setStamps(loaded);
      if (loaded[0]) setSelectedStampId(loaded[0].id);
    });
  }, []);

  const documentFile = documents.find((item) => item.id === activeDocumentId) ?? null;
  const selectedPlacement =
    placements.find((item) => item.id === selectedPlacementId && item.documentId === activeDocumentId) ?? null;
  const selectedStamp = stamps.find((stamp) => stamp.id === selectedStampId) ?? null;
  const visibleStamps = stamps.filter((stamp) => !stamp.isDerived);
  const activePlacements = documentFile
    ? placements.filter((placement) => placement.documentId === documentFile.id)
    : [];
  const visiblePages =
    documentFile && pageViewMode === 'single'
      ? documentFile.pages.filter((page) => page.pageNumber === activePageNumber)
      : documentFile?.pages ?? [];
  const contextPlacement =
    placementContextMenu && activeDocumentId
      ? placements.find((item) => item.id === placementContextMenu.placementId && item.documentId === activeDocumentId) ?? null
      : null;
  const canCreateSeamStamp = Boolean(documentFile?.kind === 'pdf' && documentFile.pages.length > 1 && contextPlacement);

  React.useEffect(() => {
    setZoomInputValue(String(Math.round(zoom * 100)));
  }, [zoom]);

  React.useLayoutEffect(() => {
    const pageNumber = pendingScrollPageRef.current;
    if (!pageNumber) return;
    pendingScrollPageRef.current = null;
    scrollEditorToPage(pageNumber);
  }, [activePageNumber, pageViewMode, activeDocumentId, visiblePages.length]);

  React.useEffect(() => {
    scrollThumbnailToPage(activePageNumber);
  }, [activePageNumber, activeDocumentId]);

  React.useEffect(() => {
    return () => {
      if (editorScrollFrame.current !== null) window.cancelAnimationFrame(editorScrollFrame.current);
    };
  }, []);

  function scrollEditorToPage(pageNumber: number) {
    window.requestAnimationFrame(() => {
      pageElementRefs.current[pageNumber]?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
        inline: 'center',
      });
    });
  }

  function scrollThumbnailToPage(pageNumber: number) {
    window.requestAnimationFrame(() => {
      pageThumbRefs.current[pageNumber]?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest',
      });
    });
  }

  function syncActivePageFromEditorScroll() {
    if (!documentFile || pageViewMode === 'single') return;
    const canvasArea = canvasAreaRef.current;
    if (!canvasArea) return;

    const areaRect = canvasArea.getBoundingClientRect();
    const viewportCenterY = areaRect.top + areaRect.height / 2;
    let nextPageNumber = activePageNumber;
    let closestDistance = Number.POSITIVE_INFINITY;

    for (const page of documentFile.pages) {
      const pageElement = pageElementRefs.current[page.pageNumber];
      if (!pageElement) continue;
      const rect = pageElement.getBoundingClientRect();
      const visibleTop = Math.max(rect.top, areaRect.top);
      const visibleBottom = Math.min(rect.bottom, areaRect.bottom);
      if (visibleBottom <= visibleTop) continue;

      const pageCenterY = rect.top + rect.height / 2;
      const distance = Math.abs(pageCenterY - viewportCenterY);
      if (distance < closestDistance) {
        closestDistance = distance;
        nextPageNumber = page.pageNumber;
      }
    }

    if (nextPageNumber !== activePageNumber) setActivePageNumber(nextPageNumber);
  }

  function handleEditorScroll() {
    if (editorScrollFrame.current !== null) return;
    editorScrollFrame.current = window.requestAnimationFrame(() => {
      editorScrollFrame.current = null;
      syncActivePageFromEditorScroll();
    });
  }

  function setZoomPercent(value: number) {
    const next = clampZoomPercent(value);
    setZoom(next / 100);
  }

  function changeZoomInput(value: string) {
    setZoomInputValue(value);
    const numericValue = Number(value);
    if (Number.isFinite(numericValue) && numericValue >= ZOOM_MIN_PERCENT && numericValue <= ZOOM_MAX_PERCENT) {
      setZoom(numericValue / 100);
    }
  }

  function commitZoomInput() {
    const next = clampZoomPercent(Number(zoomInputValue));
    setZoom(next / 100);
    setZoomInputValue(String(next));
  }

  function markDocumentDirty(documentId: string) {
    setDirtyDocumentIds((current) => {
      if (current.has(documentId)) return current;
      const next = new Set(current);
      next.add(documentId);
      return next;
    });
  }

  function markDocumentClean(documentId: string) {
    setDirtyDocumentIds((current) => {
      if (!current.has(documentId)) return current;
      const next = new Set(current);
      next.delete(documentId);
      return next;
    });
  }

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select')) return;
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedPlacementId) {
        event.preventDefault();
        deletePlacement(selectedPlacementId);
        setPlacementContextMenu(null);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedPlacementId, placements]);

  async function openDocument() {
    const payloads = await sealio.openDocument();
    if (!payloads || payloads.length === 0) return;

    setStatus(`正在渲染 ${payloads.length} 个文件...`);
    const loadedDocuments: LoadedDocument[] = [];

    for (const payload of payloads) {
      const bytes = toUint8Array(payload.bytes);
      const ext = payload.ext.toLowerCase();
      const kind: DocumentKind = ext === 'pdf' ? 'pdf' : 'image';
      const pages = kind === 'pdf' ? await renderPdfPages(bytes) : await renderImagePage(bytes, extensionToMime(ext));
      loadedDocuments.push({
        id: crypto.randomUUID(),
        name: payload.name,
        path: payload.path,
        ext,
        kind,
        bytes,
        pages,
      });
    }

    setDocuments((current) => [...current, ...loadedDocuments]);
    setActiveDocumentId(loadedDocuments[loadedDocuments.length - 1].id);
    setSelectedPlacementId(null);
    setActivePageNumber(1);
    setStatus(`已打开 ${loadedDocuments.map((item) => item.name).join('、')}`);
  }

  async function uploadStamp() {
    const uploaded = await sealio.uploadStamp();
    if (uploaded.length === 0) return;
    const next = uploaded.map((item) => {
      const bytes = toUint8Array(item.bytes);
      return {
        id: item.id,
        originalName: item.originalName,
        mimeType: item.mimeType,
        bytes,
        objectUrl: bytesToObjectUrl(bytes, item.mimeType),
      };
    });
    setStamps((current) => [...next, ...current]);
    setSelectedStampId(next[0].id);
    setStatus(`已上传 ${next.length} 个图章`);
  }

  function createStampPlacement(page: PageRender, stampId: string, x?: number, y?: number) {
    if (!documentFile) return;
    const size = DEFAULT_STAMP_SIZE;
    const placement: StampPlacement = {
      id: crypto.randomUUID(),
      documentId: documentFile.id,
      stampId,
      pageNumber: page.pageNumber,
      x: Math.round(x ?? Math.max(24, page.width - size - 60)),
      y: Math.round(y ?? Math.max(24, page.height - size - 35)),
      width: size,
      height: size,
      rotation: 0,
      opacity: 0.78,
      blendMode: 'multiply',
    };
    setPlacements((current) => [...current, placement]);
    markDocumentDirty(documentFile.id);
    setSelectedStampId(stampId);
    setSelectedPlacementId(placement.id);
    setStatus(`已添加图章，混合模式 ${blendModeLabels[placement.blendMode]}`);
  }

  function addStampAtPointer(page: PageRender, event: React.MouseEvent<HTMLDivElement>) {
    if (!selectedStampId) {
      setStatus('请先上传或选择图章');
      return;
    }

    placeStampAtClientPoint(page, event.currentTarget, selectedStampId, event.clientX, event.clientY);
  }

  function placeStampAtClientPoint(
    page: PageRender,
    pageCanvas: HTMLElement,
    stampId: string,
    clientX: number,
    clientY: number,
  ) {
    const rect = pageCanvas.getBoundingClientRect();
    const size = DEFAULT_STAMP_SIZE;
    const x = (clientX - rect.left) / zoom - size / 2;
    const y = (clientY - rect.top) / zoom - size / 2;
    const clampedX = Math.min(Math.max(0, x), Math.max(0, page.width - size));
    const clampedY = Math.min(Math.max(0, y), Math.max(0, page.height - size));
    createStampPlacement(page, stampId, clampedX, clampedY);
  }

  function getPageDropTarget(clientX: number, clientY: number) {
    if (!documentFile) return null;
    const hitElement = document.elementFromPoint(clientX, clientY);
    const pageCanvas = hitElement?.closest('.page-canvas') as HTMLDivElement | null;
    const pageNumber = Number(pageCanvas?.dataset.pageNumber ?? 0);
    const page = documentFile.pages.find((item) => item.pageNumber === pageNumber);
    return pageCanvas && page ? { pageCanvas, page } : null;
  }

  function startStampPointerDrag(event: React.PointerEvent<HTMLButtonElement>, stampId: string) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedStampId(stampId);
    stampPointerDrag.current = {
      stampId,
      startX: event.clientX,
      startY: event.clientY,
      currentX: event.clientX,
      currentY: event.clientY,
      dragging: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveStampPointerDrag(clientX: number, clientY: number) {
    const drag = stampPointerDrag.current;
    if (!drag) return;

    drag.currentX = clientX;
    drag.currentY = clientY;
    const distance = Math.hypot(clientX - drag.startX, clientY - drag.startY);
    if (!drag.dragging && distance < 4) return;

    drag.dragging = true;
    setStampDragPreview({ stampId: drag.stampId, x: clientX, y: clientY });
    const target = getPageDropTarget(clientX, clientY);
    setDragOverPage(target?.page.pageNumber ?? null);
  }

  function finishStampPointerDrag(clientX: number, clientY: number) {
    const drag = stampPointerDrag.current;
    if (!drag) return;

    const wasDragging = drag.dragging;
    stampPointerDrag.current = null;
    setStampDragPreview(null);
    setDragOverPage(null);

    if (!wasDragging) return;
    const target = getPageDropTarget(clientX, clientY);
    if (!target) {
      setStatus('请将图章拖到文件页面上');
      return;
    }

    placeStampAtClientPoint(target.page, target.pageCanvas, drag.stampId, clientX, clientY);
  }

  function moveDocumentToIndex(documentId: string, insertIndex: number) {
    setDocuments((current) => {
      const fromIndex = current.findIndex((item) => item.id === documentId);
      if (fromIndex < 0) return current;

      const moving = current[fromIndex];
      const withoutMoving = current.filter((item) => item.id !== documentId);
      const nextIndex = Math.min(Math.max(0, insertIndex), withoutMoving.length);

      const next = [...withoutMoving];
      next.splice(nextIndex, 0, moving);
      return next.every((item, index) => item.id === current[index]?.id) ? current : next;
    });
  }

  function startDocumentTabDrag(event: React.PointerEvent<HTMLDivElement>, documentId: string) {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('.file-tab-close')) return;

    documentTabDrag.current = {
      documentId,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDocumentTabDrag(clientX: number, clientY: number) {
    const drag = documentTabDrag.current;
    if (!drag) return;

    const distance = Math.hypot(clientX - drag.startX, clientY - drag.startY);
    if (!drag.dragging && distance < 6) return;
    if (!drag.dragging) {
      drag.dragging = true;
      setDraggingDocumentId(drag.documentId);
    }

    const tabs = documents
      .map((item) => {
        const element = documentTabRefs.current[item.id];
        return element ? { id: item.id, rect: element.getBoundingClientRect() } : null;
      })
      .filter((item): item is { id: string; rect: DOMRect } => Boolean(item));
    if (tabs.length < 2) return;

    const stripRect = fileTabsRef.current?.getBoundingClientRect();
    if (stripRect && fileTabsRef.current) {
      if (clientX < stripRect.left + 34) fileTabsRef.current.scrollBy({ left: -18 });
      if (clientX > stripRect.right - 34) fileTabsRef.current.scrollBy({ left: 18 });
    }

    const draggedIndex = documents.findIndex((item) => item.id === drag.documentId);
    if (draggedIndex < 0) return;

    const target = tabs.find(
      (item) =>
        item.id !== drag.documentId &&
        clientX >= item.rect.left &&
        clientX <= item.rect.right &&
        clientY >= item.rect.top - 12 &&
        clientY <= item.rect.bottom + 12,
    );

    if (target) {
      const targetIndex = documents.findIndex((item) => item.id === target.id);
      const insertAfterTarget = clientX > target.rect.left + target.rect.width / 2;
      const insertIndex = targetIndex + (insertAfterTarget ? 1 : 0) - (draggedIndex < targetIndex ? 1 : 0);
      moveDocumentToIndex(drag.documentId, insertIndex);
      return;
    }

    const first = tabs[0];
    const last = tabs[tabs.length - 1];
    if (clientX < first.rect.left) moveDocumentToIndex(drag.documentId, 0);
    if (clientX > last.rect.right) moveDocumentToIndex(drag.documentId, documents.length - 1);
  }

  function finishDocumentTabDrag() {
    const drag = documentTabDrag.current;
    if (!drag) return;

    documentTabDrag.current = null;
    setDraggingDocumentId(null);
    if (drag.dragging) {
      suppressNextTabClick.current = true;
      window.setTimeout(() => {
        suppressNextTabClick.current = false;
      }, 120);
      setStatus('已调整文件顺序');
    }
  }

  function updatePlacement(id: string, patch: Partial<StampPlacement>) {
    const target = placements.find((item) => item.id === id);
    if (target) markDocumentDirty(target.documentId);
    setPlacements((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function deletePlacement(id: string) {
    const target = placements.find((item) => item.id === id);
    if (!target) return;
    markDocumentDirty(target.documentId);
    setPlacements((current) => current.filter((item) => item.id !== id));
    setSelectedPlacementId((current) => (current === id ? null : current));
    setStatus('已删除图章');
  }

  async function createSeamStamp(placementId: string) {
    if (!documentFile || documentFile.kind !== 'pdf' || documentFile.pages.length <= 1) return;
    const sourcePlacement = placements.find((item) => item.id === placementId && item.documentId === documentFile.id);
    if (!sourcePlacement) return;
    const sourceStamp = stamps.find((item) => item.id === sourcePlacement.stampId);
    if (!sourceStamp) return;

    const pageCount = documentFile.pages.length;
    const sourceImage = await loadImage(sourceStamp.objectUrl);
    const sliceAssets: StampAsset[] = [];
    const slicePlacements: StampPlacement[] = [];
    const sliceWidth = Math.max(18, sourcePlacement.width / pageCount);
    const sliceHeight = sourcePlacement.height;
    const sourcePage =
      documentFile.pages.find((page) => page.pageNumber === sourcePlacement.pageNumber) ?? documentFile.pages[0];
    const sourceCenterYRatio = Math.min(
      1,
      Math.max(0, (sourcePlacement.y + sourcePlacement.height / 2) / sourcePage.height),
    );
    const sourceRightGap = Math.max(0, sourcePage.width - (sourcePlacement.x + sourcePlacement.width));
    const seamRightGap = 8;

    for (let index = 0; index < pageCount; index += 1) {
      const startX = Math.floor((sourceImage.naturalWidth * index) / pageCount);
      const endX = Math.floor((sourceImage.naturalWidth * (index + 1)) / pageCount);
      const sourceWidth = Math.max(1, endX - startX);
      const canvas = document.createElement('canvas');
      canvas.width = sourceWidth;
      canvas.height = sourceImage.naturalHeight;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('无法切割骑缝章');
      context.drawImage(sourceImage, startX, 0, sourceWidth, sourceImage.naturalHeight, 0, 0, sourceWidth, sourceImage.naturalHeight);
      const bytes = await canvasToPngBytes(canvas);
      const stampId = crypto.randomUUID();
      const page = documentFile.pages[index];
      const rightGap = index === pageCount - 1 ? sourceRightGap : seamRightGap;
      const x = Math.min(Math.max(0, page.width - sliceWidth - rightGap), Math.max(0, page.width - sliceWidth));
      const y = Math.min(
        Math.max(0, page.height * sourceCenterYRatio - sliceHeight / 2),
        Math.max(0, page.height - sliceHeight),
      );

      sliceAssets.push({
        id: stampId,
        originalName: `${displayNameWithoutExtension(sourceStamp.originalName)}-骑缝-${index + 1}.png`,
        mimeType: 'image/png',
        bytes,
        objectUrl: bytesToObjectUrl(bytes, 'image/png'),
        isDerived: true,
      });

      slicePlacements.push({
        id: crypto.randomUUID(),
        documentId: documentFile.id,
        stampId,
        pageNumber: page.pageNumber,
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(sliceWidth),
        height: Math.round(sliceHeight),
        rotation: SEAM_STAMP_DEFAULT_ROTATION,
        opacity: sourcePlacement.opacity,
        blendMode: sourcePlacement.blendMode,
      });
    }

    setStamps((current) => [...current, ...sliceAssets]);
    setPlacements((current) => [...current, ...slicePlacements]);
    markDocumentDirty(documentFile.id);
    setSelectedPlacementId(slicePlacements[0]?.id ?? sourcePlacement.id);
    setPlacementContextMenu(null);
    setStatus(`已生成 ${pageCount} 页骑缝章`);
  }

  function angleFromCenter(clientX: number, clientY: number, centerX: number, centerY: number) {
    return (Math.atan2(clientY - centerY, clientX - centerX) * 180) / Math.PI;
  }

  function startRotate(event: React.PointerEvent, placement: StampPlacement) {
    const pageCanvas = event.currentTarget.closest('.page-canvas');
    if (!pageCanvas) return;
    const rect = pageCanvas.getBoundingClientRect();
    const centerX = rect.left + (placement.x + placement.width / 2) * zoom;
    const centerY = rect.top + (placement.y + placement.height / 2) * zoom;
    pointerAction.current = {
      kind: 'rotate',
      id: placement.id,
      centerX,
      centerY,
      originRotation: placement.rotation,
      startAngle: angleFromCenter(event.clientX, event.clientY, centerX, centerY),
    };
  }

  function startPlacementPointer(event: React.PointerEvent, placement: StampPlacement) {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedPlacementId(placement.id);

    pointerAction.current = {
      kind: 'move',
      id: placement.id,
      startX: event.clientX,
      startY: event.clientY,
      originX: placement.x,
      originY: placement.y,
    };
  }

  function startResize(event: React.PointerEvent, placement: StampPlacement) {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedPlacementId(placement.id);
    pointerAction.current = {
      kind: 'resize',
      id: placement.id,
      startX: event.clientX,
      startY: event.clientY,
      originWidth: placement.width,
      originHeight: placement.height,
    };
  }

  function movePointerAction(clientX: number, clientY: number) {
    const action = pointerAction.current;
    if (!action) return;

    if (action.kind === 'move') {
      updatePlacement(action.id, {
        x: Math.round(action.originX + (clientX - action.startX) / zoom),
        y: Math.round(action.originY + (clientY - action.startY) / zoom),
      });
      return;
    }

    if (action.kind === 'resize') {
      const delta = Math.max(clientX - action.startX, clientY - action.startY) / zoom;
      const size = Math.max(28, Math.round(Math.max(action.originWidth, action.originHeight) + delta));
      updatePlacement(action.id, { width: size, height: size });
      return;
    }

    if (action.kind === 'rotate') {
      const angle = angleFromCenter(clientX, clientY, action.centerX, action.centerY);
      updatePlacement(action.id, { rotation: Math.round(action.originRotation + angle - action.startAngle) });
    }
  }

  function stopPointerAction() {
    pointerAction.current = null;
  }

  React.useEffect(() => {
    function onWindowPointerMove(event: PointerEvent) {
      movePointerAction(event.clientX, event.clientY);
      moveStampPointerDrag(event.clientX, event.clientY);
      moveDocumentTabDrag(event.clientX, event.clientY);
    }

    function onWindowPointerEnd(event: PointerEvent) {
      finishStampPointerDrag(event.clientX, event.clientY);
      finishDocumentTabDrag();
      stopPointerAction();
    }

    window.addEventListener('pointermove', onWindowPointerMove);
    window.addEventListener('pointerup', onWindowPointerEnd);
    window.addEventListener('pointercancel', onWindowPointerEnd);
    return () => {
      window.removeEventListener('pointermove', onWindowPointerMove);
      window.removeEventListener('pointerup', onWindowPointerEnd);
      window.removeEventListener('pointercancel', onWindowPointerEnd);
    };
  });

  function activateDocument(documentId: string) {
    const nextDocument = documents.find((item) => item.id === documentId);
    if (!nextDocument) return;
    setActiveDocumentId(documentId);
    setActivePageNumber(1);
    setSelectedPlacementId(null);
    setStatus(`已切换到 ${nextDocument.name}`);
  }

  function selectPage(pageNumber: number) {
    pendingScrollPageRef.current = pageNumber;
    setActivePageNumber(pageNumber);
    scrollEditorToPage(pageNumber);
    setStatus(`已定位到第 ${pageNumber} 页`);
  }

  function closeDocument(documentId: string, event: React.MouseEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    const targetDocument = documents.find((item) => item.id === documentId);
    if (targetDocument && dirtyDocumentIds.has(documentId)) {
      const confirmed = window.confirm(`"${targetDocument.name}" 有未导出的改动，确定要关闭吗？`);
      if (!confirmed) return;
    }

    const index = documents.findIndex((item) => item.id === documentId);
    const nextDocuments = documents.filter((item) => item.id !== documentId);
    const shouldSwitchActive = documentId === activeDocumentId || !nextDocuments.some((item) => item.id === activeDocumentId);

    setDocuments(nextDocuments);
    setPlacements((current) => current.filter((placement) => placement.documentId !== documentId));
    markDocumentClean(documentId);
    if (shouldSwitchActive) {
      const fallback = nextDocuments[Math.max(0, index - 1)] ?? nextDocuments[0] ?? null;
      setActiveDocumentId(fallback?.id ?? null);
      setActivePageNumber(1);
      setSelectedPlacementId(null);
    }
    setStatus(targetDocument ? `已关闭 ${targetDocument.name}` : '已关闭文件');
  }

  async function exportDocument() {
    if (!documentFile) {
      setStatus('请先打开文件');
      return;
    }
    setIsExporting(true);
    try {
      const defaultType = defaultExportFileType(documentFile);
      const selectedPath = await sealio.pickExportPath({
        defaultName: downloadName(documentFile.name, defaultType),
      });
      if (!selectedPath) {
        setStatus('已取消导出');
        return;
      }

      const targetType = exportFileTypeFromPath(selectedPath) ?? defaultType;
      const exportPath = ensureExportPathExtension(selectedPath, targetType);
      const bytes =
        targetType === 'pdf'
          ? Array.from(await exportDocumentAsPdf(documentFile, activePlacements, stamps))
          : await exportDocumentAsImage(documentFile, activePlacements, stamps, targetType, activePageNumber);
      const path = await sealio.writeExport({ path: exportPath, bytes });
      markDocumentClean(documentFile.id);
      setStatus(`已导出 ${path}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '导出失败');
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="titlebar">
        <div className="window-spacer" />
        <div className="app-title">Sealio 图章工具</div>
      </header>

      <section className="top-toolbar">
        <button className="icon-button" onClick={openDocument} title="打开本地 PDF 或图片文件" aria-label="打开文件">
          <IconOpenFile />
        </button>
        <button
          className="icon-button primary-action"
          onClick={exportDocument}
          disabled={isExporting}
          title={isExporting ? '正在导出当前激活文件' : '导出当前激活文件'}
          aria-label="导出新文件"
        >
          <IconExportFile />
        </button>
        <div className="toolbar-separator" />
        <label className="zoom-control">
          <span>缩放</span>
          <input
            type="range"
            min={ZOOM_MIN_PERCENT}
            max={ZOOM_MAX_PERCENT}
            step={1}
            value={Math.round(zoom * 100)}
            title="拖动调整缩放比例"
            onChange={(event) => setZoomPercent(Number(event.target.value))}
          />
          <input
            className="zoom-input"
            type="number"
            min={ZOOM_MIN_PERCENT}
            max={ZOOM_MAX_PERCENT}
            step={1}
            value={zoomInputValue}
            title="输入缩放比例"
            onChange={(event) => changeZoomInput(event.target.value)}
            onBlur={commitZoomInput}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
          />
          <span className="zoom-unit">%</span>
        </label>
        <div className="segmented">
          <button
            className={pageViewMode === 'multi' ? 'active' : ''}
            onClick={() => setPageViewMode('multi')}
            title="多页纵向展示"
          >
            多页
          </button>
          <button
            className={pageViewMode === 'single' ? 'active' : ''}
            onClick={() => setPageViewMode('single')}
            title="单页展示当前页面"
          >
            单页
          </button>
        </div>
      </section>

      <section className="file-tabs" aria-label="已打开文件" ref={fileTabsRef}>
        {documents.length > 0 ? (
          documents.map((item) => (
            <div
              className={`file-tab ${item.id === activeDocumentId ? 'active' : ''} ${
                item.id === draggingDocumentId ? 'dragging' : ''
              }`}
              key={item.id}
              ref={(element) => {
                documentTabRefs.current[item.id] = element;
              }}
              role="button"
              tabIndex={0}
              onPointerDown={(event) => startDocumentTabDrag(event, item.id)}
              onClick={(event) => {
                if (suppressNextTabClick.current) {
                  event.preventDefault();
                  event.stopPropagation();
                  return;
                }
                activateDocument(item.id);
              }}
              onKeyDown={(event) => {
                const target = event.target as HTMLElement | null;
                if (target?.closest('.file-tab-close')) return;
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  activateDocument(item.id);
                }
              }}
              title={`切换到 ${item.name}`}
            >
              <span className="file-tab-name">{item.name}</span>
              <span
                className={`file-tab-dirty ${dirtyDocumentIds.has(item.id) ? '' : 'placeholder'}`}
                title={dirtyDocumentIds.has(item.id) ? '有未导出的改动' : undefined}
              />
              <span className="file-tab-meta">{item.kind.toUpperCase()}</span>
              <button
                type="button"
                className="file-tab-close"
                onClick={(event) => closeDocument(item.id, event)}
                aria-label={`关闭 ${item.name}`}
                title={`关闭 ${item.name}`}
              >
                ×
              </button>
            </div>
          ))
        ) : (
          <div className="file-tabs-empty">可同时打开多个 PDF 或图片文件</div>
        )}
      </section>

      <main className="workspace">
        <aside className="page-panel">
          <div className="panel-title">页面</div>
          {documentFile ? (
            documentFile.pages.map((page) => (
              <button
                className={`page-thumb ${page.pageNumber === activePageNumber ? 'active' : ''}`}
                key={page.pageNumber}
                ref={(element) => {
                  pageThumbRefs.current[page.pageNumber] = element;
                }}
                onClick={() => selectPage(page.pageNumber)}
                title={`定位到第 ${page.pageNumber} 页`}
              >
                <img src={page.dataUrl} alt={`第${page.pageNumber}页`} />
                <span>第{page.pageNumber}页</span>
              </button>
            ))
          ) : (
            <div className="empty-panel">打开 PDF 或图片后显示页面</div>
          )}
        </aside>

        <section
          className="canvas-area"
          ref={canvasAreaRef}
          onScroll={handleEditorScroll}
          onClick={() => setPlacementContextMenu(null)}
          onContextMenu={(event) => {
            event.preventDefault();
            setPlacementContextMenu(null);
          }}
        >
          {documentFile ? (
            <div className={`document-stack ${pageViewMode === 'single' ? 'single-page' : 'multi-page'}`}>
              {visiblePages.map((page) => (
                <div
                  className="page-wrap"
                  key={page.pageNumber}
                  ref={(element) => {
                    pageElementRefs.current[page.pageNumber] = element;
                  }}
                >
                  <div
                    className={`page-canvas ${dragOverPage === page.pageNumber ? 'drag-over' : ''}`}
                    data-page-number={page.pageNumber}
                    style={{ width: page.width * zoom, height: page.height * zoom }}
                    onDoubleClick={(event) => addStampAtPointer(page, event)}
                  >
                    <img src={page.dataUrl} alt={`第${page.pageNumber}页`} draggable={false} />
                    {activePlacements
                      .filter((placement) => placement.pageNumber === page.pageNumber)
                      .map((placement) => {
                        const stamp = stamps.find((item) => item.id === placement.stampId);
                        if (!stamp) return null;
                        const selected = placement.id === selectedPlacementId;
                        return (
                          <button
                            className={`stamp-placement ${selected ? 'selected' : ''}`}
                            key={placement.id}
                            title={`图章：${displayNameWithoutExtension(stamp.originalName)}`}
                            style={{
                              left: placement.x * zoom,
                              top: placement.y * zoom,
                              width: placement.width * zoom,
                              height: placement.height * zoom,
                              opacity: placement.opacity,
                              mixBlendMode: placement.blendMode,
                              transform: `rotate(${placement.rotation}deg)`,
                            }}
                            onPointerDown={(event) => startPlacementPointer(event, placement)}
                            onContextMenu={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              setSelectedPlacementId(placement.id);
                              setPlacementContextMenu({
                                x: event.clientX,
                                y: event.clientY,
                                placementId: placement.id,
                              });
                            }}
                            onDoubleClick={(event) => event.stopPropagation()}
                          >
                            <img src={stamp.objectUrl} alt={stamp.originalName} draggable={false} />
                            {selected && (
                              <>
                                <span
                                  className="resize-handle"
                                  title="拖动缩放"
                                  onPointerDown={(event) => startResize(event, placement)}
                                />
                                <span
                                  className="rotate-handle"
                                  title="拖动旋转"
                                  onPointerDown={(event) => {
                                    event.stopPropagation();
                                    event.currentTarget.setPointerCapture(event.pointerId);
                                    startRotate(event, placement);
                                  }}
                                />
                              </>
                            )}
                          </button>
                        );
                      })}
                  </div>
                  <div className="page-label">第{page.pageNumber}页</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <strong>打开本地文件开始</strong>
              <span>支持 PDF、PNG、JPG、JPEG。上传图章后，双击页面即可放置。</span>
            </div>
          )}
        </section>

        <aside className="right-panel">
          <section className="panel-block stamp-panel">
            <div className="panel-title with-actions">
              <span>图章</span>
              <div className="panel-actions">
                <button className="manage-stamps-button" onClick={() => setIsStampManagerOpen(true)} title="打开图章管理">
                  图章管理
                </button>
                <div className="view-toggle" aria-label="图章历史展示方式">
                  <button
                    className={stampHistoryView === 'list' ? 'active' : ''}
                    onClick={() => setStampHistoryView('list')}
                    title="列表展示"
                  >
                    列表
                  </button>
                  <button
                    className={stampHistoryView === 'card' ? 'active' : ''}
                    onClick={() => setStampHistoryView('card')}
                    title="卡片展示"
                  >
                    卡片
                  </button>
                </div>
              </div>
            </div>
            <div className={`stamp-history ${stampHistoryView}`}>
              {visibleStamps.length > 0 ? (
                visibleStamps.map((stamp) => (
                  <button
                    className={`stamp-item ${stamp.id === selectedStampId ? 'selected' : ''}`}
                    key={stamp.id}
                    title={`选择图章：${displayNameWithoutExtension(stamp.originalName)}`}
                    onPointerDown={(event) => startStampPointerDrag(event, stamp.id)}
                    onClick={() => setSelectedStampId(stamp.id)}
                  >
                    <img src={stamp.objectUrl} alt={stamp.originalName} />
                    <span>{displayNameWithoutExtension(stamp.originalName)}</span>
                  </button>
                ))
              ) : (
                <div className="empty-panel">上传图章后自动保存到本地历史</div>
              )}
            </div>
          </section>

          <section className="panel-block">
            <div className="panel-title">属性</div>
            {selectedPlacement ? (
              <div className="property-grid">
                <label>
                  混合模式
                  <select
                    value={selectedPlacement.blendMode}
                    onChange={(event) =>
                      updatePlacement(selectedPlacement.id, { blendMode: event.target.value as BlendModeKey })
                    }
                  >
                    {Object.entries(blendModeLabels).map(([value, label]) => (
                      <option value={value} key={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  不透明度 {Math.round(selectedPlacement.opacity * 100)}%
                  <input
                    type="range"
                    min={0.1}
                    max={1}
                    step={0.01}
                    value={selectedPlacement.opacity}
                    onChange={(event) => updatePlacement(selectedPlacement.id, { opacity: Number(event.target.value) })}
                  />
                </label>
                <label>
                  大小
                  <input
                    type="number"
                    value={Math.round(selectedPlacement.width)}
                    onChange={(event) => {
                      const size = Number(event.target.value);
                      updatePlacement(selectedPlacement.id, { width: size, height: size });
                    }}
                  />
                </label>
                <label>
                  旋转
                  <input
                    type="number"
                    value={selectedPlacement.rotation}
                    onChange={(event) => updatePlacement(selectedPlacement.id, { rotation: Number(event.target.value) })}
                  />
                </label>
                <label>
                  X
                  <input
                    type="number"
                    value={Math.round(selectedPlacement.x)}
                    onChange={(event) => updatePlacement(selectedPlacement.id, { x: Number(event.target.value) })}
                  />
                </label>
                <label>
                  Y
                  <input
                    type="number"
                    value={Math.round(selectedPlacement.y)}
                    onChange={(event) => updatePlacement(selectedPlacement.id, { y: Number(event.target.value) })}
                  />
                </label>
              </div>
            ) : (
              <div className="empty-panel">
                {selectedStamp ? `当前图章：${displayNameWithoutExtension(selectedStamp.originalName)}` : '选择图章并放置后显示属性'}
              </div>
            )}
          </section>
        </aside>
      </main>

      {placementContextMenu && contextPlacement && (
        <div
          className="placement-context-menu"
          style={{ left: placementContextMenu.x, top: placementContextMenu.y }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          {canCreateSeamStamp && (
            <button onClick={() => createSeamStamp(contextPlacement.id)} title="生成骑缝章">
              骑缝章
            </button>
          )}
          <button
            className="danger"
            title="删除当前图章"
            onClick={() => {
              deletePlacement(contextPlacement.id);
              setPlacementContextMenu(null);
            }}
          >
            删除图章
          </button>
        </div>
      )}

      {stampDragPreview &&
        (() => {
          const stamp = stamps.find((item) => item.id === stampDragPreview.stampId);
          if (!stamp) return null;
          return (
            <div className="stamp-drag-preview" style={{ left: stampDragPreview.x, top: stampDragPreview.y }}>
              <img src={stamp.objectUrl} alt={stamp.originalName} />
            </div>
          );
        })()}

      <footer className="statusbar">
        <span>
          {documentFile
            ? `${documentFile.name} | ${documentFile.kind.toUpperCase()} | ${documentFile.pages.length}页 | ${formatFileSize(documentFile.bytes.byteLength)}`
            : '未打开文件'}
        </span>
        <span>本地图章历史 {visibleStamps.length} 个</span>
        <span>{selectedPlacement ? `混合模式 ${blendModeLabels[selectedPlacement.blendMode]}` : status}</span>
      </footer>

      {isStampManagerOpen && (
        <div className="modal-backdrop" onClick={() => setIsStampManagerOpen(false)}>
          <section className="stamp-manager-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className="modal-header">
              <div>
                <h2>图章管理</h2>
                <p>已上传 {visibleStamps.length} 个图章，可继续上传新图章。</p>
              </div>
              <button
                className="modal-close"
                onClick={() => setIsStampManagerOpen(false)}
                aria-label="关闭"
                title="关闭图章管理"
              >
                ×
              </button>
            </header>
            <div className="modal-toolbar">
              <button className="primary-action" onClick={uploadStamp} title="上传新的图章图片">
                上传新图章
              </button>
            </div>
            <div className="managed-stamp-grid">
              {visibleStamps.length > 0 ? (
                visibleStamps.map((stamp) => (
                  <button
                    className={`managed-stamp-card ${stamp.id === selectedStampId ? 'selected' : ''}`}
                    key={stamp.id}
                    onClick={() => setSelectedStampId(stamp.id)}
                    title={`选择图章：${displayNameWithoutExtension(stamp.originalName)}`}
                  >
                    <img src={stamp.objectUrl} alt={stamp.originalName} />
                    <span>{displayNameWithoutExtension(stamp.originalName)}</span>
                  </button>
                ))
              ) : (
                <div className="empty-panel">还没有图章，点击“上传新图章”添加。</div>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

async function exportPdf(documentFile: LoadedDocument, placements: StampPlacement[], stamps: StampAsset[]) {
  const pdfDoc = await PDFDocument.load(documentFile.bytes);
  const pages = pdfDoc.getPages();

  for (const placement of placements) {
    const page = pages[placement.pageNumber - 1];
    const renderedPage = documentFile.pages.find((item) => item.pageNumber === placement.pageNumber);
    const stamp = stamps.find((item) => item.id === placement.stampId);
    if (!page || !renderedPage || !stamp) continue;

    const embedded = stamp.mimeType === 'image/png' ? await pdfDoc.embedPng(stamp.bytes) : await pdfDoc.embedJpg(stamp.bytes);
    const { width: pdfWidth, height: pdfHeight } = page.getSize();
    const x = (placement.x / renderedPage.width) * pdfWidth;
    const width = (placement.width / renderedPage.width) * pdfWidth;
    const height = (placement.height / renderedPage.height) * pdfHeight;
    const y = pdfHeight - ((placement.y / renderedPage.height) * pdfHeight + height);

    page.drawImage(embedded, {
      x,
      y,
      width,
      height,
      rotate: degrees(placement.rotation),
      opacity: placement.opacity,
      blendMode: pdfBlendMap[placement.blendMode],
    });
  }

  return pdfDoc.save();
}

async function exportDocumentAsPdf(documentFile: LoadedDocument, placements: StampPlacement[], stamps: StampAsset[]) {
  if (documentFile.kind === 'pdf') return exportPdf(documentFile, placements, stamps);

  const page = documentFile.pages[0];
  const imageBytes = await exportPageAsImage(documentFile, placements, stamps, 1, 'image/png');
  const pdfDoc = await PDFDocument.create();
  const pdfPage = pdfDoc.addPage([page.width, page.height]);
  const image = await pdfDoc.embedPng(new Uint8Array(imageBytes));
  pdfPage.drawImage(image, {
    x: 0,
    y: 0,
    width: page.width,
    height: page.height,
  });
  return pdfDoc.save();
}

async function exportDocumentAsImage(
  documentFile: LoadedDocument,
  placements: StampPlacement[],
  stamps: StampAsset[],
  fileType: ExportFileType,
  activePageNumber: number,
) {
  const pageNumber = documentFile.kind === 'pdf' ? activePageNumber : 1;
  return exportPageAsImage(documentFile, placements, stamps, pageNumber, imageMimeForExport(fileType));
}

async function exportPageAsImage(
  documentFile: LoadedDocument,
  placements: StampPlacement[],
  stamps: StampAsset[],
  pageNumber: number,
  mimeType: string,
) {
  const page = documentFile.pages.find((item) => item.pageNumber === pageNumber) ?? documentFile.pages[0];
  const source = await loadImage(page.dataUrl);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建图片导出画布');
  canvas.width = page.width;
  canvas.height = page.height;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, page.width, page.height);
  context.drawImage(source, 0, 0, page.width, page.height);

  for (const placement of placements.filter((item) => item.pageNumber === page.pageNumber)) {
    const stamp = stamps.find((item) => item.id === placement.stampId);
    if (!stamp) continue;
    const image = await loadImage(stamp.objectUrl);
    context.save();
    context.globalAlpha = placement.opacity;
    context.globalCompositeOperation = canvasBlendMap[placement.blendMode];
    context.translate(placement.x + placement.width / 2, placement.y + placement.height / 2);
    context.rotate((placement.rotation * Math.PI) / 180);
    context.drawImage(image, -placement.width / 2, -placement.height / 2, placement.width, placement.height);
    context.restore();
  }

  return encodeCanvasBytes(canvas, mimeType);
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
