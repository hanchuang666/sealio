import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

export type NativeFilePayload = {
  path: string;
  name: string;
  ext: string;
  bytes: number[];
};

export type NativeStampPayload = {
  id: string;
  originalName: string;
  storedPath: string;
  mimeType: string;
  createdAt: number;
  bytes: number[];
};

export type NativeCloseRequestedEvent = {
  preventDefault: () => void;
};

export type NativeDocumentDropEvent = {
  type: 'enter' | 'over' | 'drop' | 'leave';
  paths: string[];
  files?: File[];
};

type SaveExportPayload = {
  defaultName: string;
};

type WriteExportPayload = {
  path: string;
  bytes: number[];
};

type BackendStampPayload = {
  id: string;
  originalName: string;
  url: string;
  mimeType: string;
  createdAt: number;
};

const documentAccept = '.pdf,.png,.jpg,.jpeg';
const stampAccept = '.png,.jpg,.jpeg';
const supportedDocumentExtensions = new Set(['pdf', 'png', 'jpg', 'jpeg']);
const supportedStampExtensions = new Set(['png', 'jpg', 'jpeg']);

export function isTauriRuntime() {
  return Boolean('__TAURI_INTERNALS__' in window);
}

function extensionForName(name: string) {
  return name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
}

function mimeForPath(path: string) {
  const ext = extensionForName(path);
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'png') return 'image/png';
  return 'image/jpeg';
}

async function fileToPayload(file: File): Promise<NativeFilePayload> {
  return {
    path: file.name,
    name: file.name,
    ext: extensionForName(file.name),
    bytes: Array.from(new Uint8Array(await file.arrayBuffer())),
  };
}

function pickFiles(accept: string) {
  return new Promise<File[] | null>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = accept;
    input.style.display = 'none';
    input.addEventListener('change', () => {
      resolve(input.files ? Array.from(input.files) : null);
      input.remove();
    });
    input.addEventListener('cancel', () => {
      resolve(null);
      input.remove();
    });
    document.body.append(input);
    input.click();
  });
}

function downloadBytes(path: string, bytes: number[]) {
  const blob = new Blob([new Uint8Array(bytes)], { type: mimeForPath(path) });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = path.split(/[\\/]/).pop() || 'sealio-export';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function uploadFiles(endpoint: string, files: File[]) {
  const form = new FormData();
  files.forEach((file) => form.append('file', file));
  const response = await fetch(endpoint, { method: 'POST', body: form });
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as BackendStampPayload[];
}

async function stampPayloadFromBackend(item: BackendStampPayload): Promise<NativeStampPayload> {
  const response = await fetch(item.url);
  if (!response.ok) throw new Error(`图章读取失败：${item.originalName}`);
  return {
    id: item.id,
    originalName: item.originalName,
    storedPath: item.url,
    mimeType: item.mimeType,
    createdAt: item.createdAt,
    bytes: Array.from(new Uint8Array(await response.arrayBuffer())),
  };
}

async function stampPayloadFromFile(file: File, item: BackendStampPayload): Promise<NativeStampPayload> {
  return {
    id: item.id,
    originalName: item.originalName,
    storedPath: item.url,
    mimeType: item.mimeType,
    createdAt: item.createdAt,
    bytes: Array.from(new Uint8Array(await file.arrayBuffer())),
  };
}

function createBeforeUnloadEvent(event: BeforeUnloadEvent): NativeCloseRequestedEvent {
  return {
    preventDefault: () => {
      event.preventDefault();
      event.returnValue = '';
    },
  };
}

export const sealio = {
  openDocument: async () => {
    if (isTauriRuntime()) return invoke<NativeFilePayload[] | null>('open_document');

    const files = await pickFiles(documentAccept);
    if (!files || files.length === 0) return null;
    const supported = files.filter((file) => supportedDocumentExtensions.has(extensionForName(file.name)));
    if (supported.length === 0) return [];
    await uploadFiles('/api/uploads', supported);
    return Promise.all(supported.map(fileToPayload));
  },
  openDocumentPaths: (paths: string[]) => {
    if (isTauriRuntime()) return invoke<NativeFilePayload[]>('open_document_paths', { paths });
    return Promise.resolve([]);
  },
  openDocumentFiles: async (files: File[]) => {
    const supported = files.filter((file) => supportedDocumentExtensions.has(extensionForName(file.name)));
    if (supported.length === 0) return [];
    await uploadFiles('/api/uploads', supported);
    return Promise.all(supported.map(fileToPayload));
  },
  uploadStamp: async () => {
    if (isTauriRuntime()) return invoke<NativeStampPayload[]>('upload_stamp');

    const files = await pickFiles(stampAccept);
    if (!files || files.length === 0) return [];
    const supported = files.filter((file) => supportedStampExtensions.has(extensionForName(file.name)));
    if (supported.length === 0) return [];
    const uploaded = await uploadFiles('/api/stamps', supported);
    return Promise.all(uploaded.map((item, index) => stampPayloadFromFile(supported[index], item)));
  },
  listStamps: async () => {
    if (isTauriRuntime()) return invoke<NativeStampPayload[]>('list_stamps');

    const response = await fetch('/api/stamps');
    if (!response.ok) return [];
    const stamps = (await response.json()) as BackendStampPayload[];
    return Promise.all(stamps.map(stampPayloadFromBackend));
  },
  pickExportPath: (payload: SaveExportPayload) => {
    if (isTauriRuntime()) return invoke<string | null>('pick_export_path', { payload });
    return Promise.resolve(payload.defaultName);
  },
  writeExport: (payload: WriteExportPayload) => {
    if (isTauriRuntime()) return invoke<string>('write_export', { payload });
    downloadBytes(payload.path, payload.bytes);
    return Promise.resolve(payload.path);
  },
  startWindowDrag: () => {
    if (isTauriRuntime()) return getCurrentWindow().startDragging();
    return Promise.resolve();
  },
  closeWindow: () => {
    if (isTauriRuntime()) return getCurrentWindow().close();
    window.close();
    return Promise.resolve();
  },
  onWindowCloseRequested: async (handler: (event: NativeCloseRequestedEvent) => void | Promise<void>) => {
    if (isTauriRuntime()) {
      return getCurrentWindow().onCloseRequested(handler);
    }

    const listener = (event: BeforeUnloadEvent) => {
      void handler(createBeforeUnloadEvent(event));
    };
    window.addEventListener('beforeunload', listener);
    return () => window.removeEventListener('beforeunload', listener);
  },
  onDocumentDrop: async (handler: (event: NativeDocumentDropEvent) => void | Promise<void>) => {
    if (isTauriRuntime()) {
      return getCurrentWindow().onDragDropEvent((event) => {
        void handler(event.payload as NativeDocumentDropEvent);
      });
    }

    const toFiles = (event: DragEvent) => Array.from(event.dataTransfer?.files ?? []);
    const onDragEnter = (event: DragEvent) => {
      event.preventDefault();
      void handler({ type: 'enter', paths: [], files: toFiles(event) });
    };
    const onDragOver = (event: DragEvent) => {
      event.preventDefault();
      void handler({ type: 'over', paths: [], files: toFiles(event) });
    };
    const onDragLeave = (event: DragEvent) => {
      event.preventDefault();
      void handler({ type: 'leave', paths: [], files: toFiles(event) });
    };
    const onDrop = (event: DragEvent) => {
      event.preventDefault();
      void handler({ type: 'drop', paths: [], files: toFiles(event) });
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);

    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  },
};
