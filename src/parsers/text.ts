/**
 * Low-level text helpers mirroring C `strtol` / `strtod` semantics, which is
 * what every legacy boardview format was written against.
 */

const INT_RE = /\s*([+-]?\d+)/y;
const NUM_RE = /\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/y;

let utf8Strict: TextDecoder | null = null;
let latin: TextDecoder | null = null;

/** Decodes bytes as UTF-8 when valid, otherwise as Windows-1252. */
export function decodeText(bytes: Uint8Array): string {
  utf8Strict ??= new TextDecoder('utf-8', { fatal: true });
  try {
    return utf8Strict.decode(bytes);
  } catch {
    latin ??= new TextDecoder('windows-1252');
    return latin.decode(bytes);
  }
}

export function splitLines(text: string): string[] {
  return text.split(/\r\n|\n|\r/);
}

/** Sequential field reader over a single line. */
export class Fields {
  pos = 0;
  constructor(
    readonly line: string,
    /** Optional single-character delimiter consumed after numbers and strings (e.g. `!`). */
    readonly delim?: string,
  ) {}

  private eatDelim(): void {
    if (this.delim && this.line[this.pos] === this.delim) this.pos++;
  }

  private skipSpace(): void {
    const l = this.line;
    while (this.pos < l.length && /\s/.test(l[this.pos]) && l[this.pos] !== this.delim) this.pos++;
  }

  int(): number {
    INT_RE.lastIndex = this.pos;
    const m = INT_RE.exec(this.line);
    if (!m) {
      this.eatDelim();
      return 0;
    }
    this.pos = INT_RE.lastIndex;
    this.eatDelim();
    return parseInt(m[1], 10);
  }

  num(): number {
    NUM_RE.lastIndex = this.pos;
    const m = NUM_RE.exec(this.line);
    if (!m) {
      this.eatDelim();
      return 0;
    }
    this.pos = NUM_RE.lastIndex;
    this.eatDelim();
    return parseFloat(m[1]);
  }

  /** Reads a token up to the delimiter (or whitespace when no delimiter is set). */
  str(): string {
    this.skipSpace();
    const l = this.line;
    const start = this.pos;
    if (this.delim) {
      while (this.pos < l.length && l[this.pos] !== this.delim) this.pos++;
    } else {
      while (this.pos < l.length && !/\s/.test(l[this.pos])) this.pos++;
    }
    const s = l.slice(start, this.pos);
    if (this.pos < l.length) this.pos++; // consume delimiter / single whitespace
    return s;
  }

  skip(n: number): this {
    this.pos = Math.min(this.line.length, this.pos + n);
    return this;
  }

  /** Whether anything but whitespace remains. */
  get more(): boolean {
    return /\S/.test(this.line.slice(this.pos));
  }
}

export function startsWithBytes(data: Uint8Array, sig: number[], offset = 0): boolean {
  if (data.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (data[offset + i] !== sig[i]) return false;
  return true;
}

/** Fast ASCII substring search on raw bytes (limited window for big files). */
export function bytesInclude(data: Uint8Array, needle: string, limit = data.length): boolean {
  const n = needle.length;
  const first = needle.charCodeAt(0);
  const end = Math.min(limit, data.length) - n;
  outer: for (let i = 0; i <= end; i++) {
    if (data[i] !== first) continue;
    for (let j = 1; j < n; j++) if (data[i + j] !== needle.charCodeAt(j)) continue outer;
    return true;
  }
  return false;
}

export function u32le(d: Uint8Array, o: number): number {
  if (o + 4 > d.length) throw new Error(`Lectura fuera de rango en offset ${o}`);
  return (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;
}

export function i16le(d: Uint8Array, o: number): number {
  if (o + 2 > d.length) throw new Error(`Lectura fuera de rango en offset ${o}`);
  const v = d[o] | (d[o + 1] << 8);
  return v & 0x8000 ? v - 0x10000 : v;
}
