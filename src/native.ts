import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow, type CloseRequestedEvent, type DragDropEvent } from '@tauri-apps/api/window';

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

type SaveExportPayload = {
  defaultName: string;
};

type WriteExportPayload = {
  path: string;
  bytes: number[];
};

export const sealio = {
  openDocument: () => invoke<NativeFilePayload[] | null>('open_document'),
  openDocumentPaths: (paths: string[]) => invoke<NativeFilePayload[]>('open_document_paths', { paths }),
  uploadStamp: () => invoke<NativeStampPayload[]>('upload_stamp'),
  listStamps: () => invoke<NativeStampPayload[]>('list_stamps'),
  pickExportPath: (payload: SaveExportPayload) => invoke<string | null>('pick_export_path', { payload }),
  writeExport: (payload: WriteExportPayload) => invoke<string>('write_export', { payload }),
  startWindowDrag: () => getCurrentWindow().startDragging(),
  closeWindow: () => getCurrentWindow().close(),
  onWindowCloseRequested: (handler: (event: CloseRequestedEvent) => void | Promise<void>) =>
    getCurrentWindow().onCloseRequested(handler),
  onDocumentDrop: (handler: (event: DragDropEvent) => void | Promise<void>) =>
    getCurrentWindow().onDragDropEvent((event) => {
      void handler(event.payload);
    }),
};
