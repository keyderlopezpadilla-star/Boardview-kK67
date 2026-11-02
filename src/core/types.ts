/**
 * Board data model.
 *
 * All coordinates are expressed in mils (1/1000 inch), Y axis pointing up,
 * which is the de-facto convention shared by every boardview format.
 */

export type Side = 'top' | 'bottom' | 'both';

export interface Pt {
  x: number;
  y: number;
}

/* ------------------------------------------------------------------ */
/* Raw (format-agnostic) intermediate representation, produced by parsers */
/* ------------------------------------------------------------------ */

export interface RawPart {
  name: string;
  side: Side;
  smd: boolean;
  /** Free-text description / manufacturer code when the format provides one. */
  mfg?: string;
}

export interface RawPin {
  x: number;
  y: number;
  /** 1-based index into `parts`; 0 means "no owning part" (orphan / test pad). */
  part: number;
  net: string;
  side: Side;
  name?: string;
  num?: string;
  radius?: number;
  probe?: number;
}

export interface RawNail {
  x: number;
  y: number;
  side: Side;
  net: string;
  probe?: number;
}

export interface RawBoard {
  format: string;
  /** Closed board outline polylines. */
  outline: Pt[][];
  parts: RawPart[];
  pins: RawPin[];
  nails: RawNail[];
  warnings?: string[];
}

/* ------------------------------------------------------------------ */
/* Final board model consumed by the renderer and the UI               */
/* ------------------------------------------------------------------ */

export type NetKind = 'ground' | 'power' | 'signal' | 'nc';

export interface OrientedRect {
  cx: number;
  cy: number;
  w: number;
  h: number;
  /** Rotation in radians. */
  angle: number;
}

export interface Part {
  id: number;
  name: string;
  side: Side;
  smd: boolean;
  mfg?: string;
  pins: number[];
  rect: OrientedRect;
  /** Pseudo-parts generated for orphan pads / test points. */
  virtual: boolean;
}

export interface Pin {
  id: number;
  part: number; // -1 when orphan
  x: number;
  y: number;
  r: number;
  side: Side;
  net: number;
  num: string;
  name: string;
  probe?: number;
}

export interface Nail {
  id: number;
  x: number;
  y: number;
  side: Side;
  net: number;
  probe?: number;
}

export interface Net {
  id: number;
  name: string;
  kind: NetKind;
  pins: number[];
  nails: number[];
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Board {
  fileName: string;
  format: string;
  outline: Pt[][];
  parts: Part[];
  pins: Pin[];
  nails: Nail[];
  nets: Net[];
  bounds: Bounds;
  warnings: string[];
}

/* ------------------------------------------------------------------ */
/* Worker protocol                                                      */
/* ------------------------------------------------------------------ */

export interface InputFile {
  name: string;
  data: Uint8Array;
}

export interface ParseKeys {
  /** 44 x 32-bit words, RC6 key for encrypted ASUS .fz files. */
  fz?: number[];
  /** 16 hex chars, DES key for XZZ .pcb files. */
  xzz?: string;
}

export type WorkerRequest =
  | { id: number; type: 'parse'; files: InputFile[]; keys: ParseKeys; pick?: string };

export type WorkerResponse =
  | { id: number; type: 'board'; board: Board | null; attachments: InputFile[] }
  | { id: number; type: 'choose'; candidates: string[] }
  | { id: number; type: 'error'; message: string };
