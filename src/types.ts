export type DocumentKind = 'pdf' | 'image';
export type BlendModeKey = 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten';
export type ExportFileType = 'pdf' | 'png' | 'jpg' | 'jpeg';

export type PageRender = {
  pageNumber: number;
  width: number;
  height: number;
  dataUrl: string;
};

export type LoadedDocument = {
  id: string;
  name: string;
  path: string;
  ext: string;
  kind: DocumentKind;
  bytes: Uint8Array;
  pages: PageRender[];
};

export type StampAsset = {
  id: string;
  originalName: string;
  mimeType: string;
  bytes: Uint8Array;
  objectUrl: string;
  sourceUrl?: string;
  isDerived?: boolean;
};

export type StampPlacement = {
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
