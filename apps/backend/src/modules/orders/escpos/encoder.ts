// Native ESC/POS text encoder: code-page aware byte encoding, column-exact
// wrapping for 58 mm / 80 mm paper, printer-native alignment / bold / size
// commands, and an explicit state reset at the end of every job. Nothing here
// rasterises text - every glyph is printed by the printer's own font.
//
// No I/O and no randomness, so the exact bytes are asserted in unit tests.
// What it cannot assert is how a given printer model renders them: code page
// numbering and cutter support vary, so check a test print on the real unit.

import { CODEPAGES, type CodepageName } from './codepages';

export type { CodepageName } from './codepages';
export type PaperWidthMm = 58 | 80;
export type TextSize = 'normal' | 'tall' | 'wide' | 'big';
export type Align = 'left' | 'center' | 'right';

export interface PrinterProfile {
  paperWidthMm: PaperWidthMm;
  /** Printable characters per line in the normal (Font A) size. */
  columns: number;
  codepage: CodepageName;
  /**
   * "Picture" printing (code page setting PICTURE): for Tamil and other
   * scripts no printer code page has. The job's lines are also recorded as a
   * PictureJob; the app draws them with the device's fonts and prints the
   * picture (apps/web/lib/print-picture.ts).
   */
  picture?: boolean;
}

/** Settings value of the "Tamil / Indian languages (picture)" character set. */
export const PICTURE_CODEPAGE = 'PICTURE';

/** One printed line of a picture job, in the original text (any script). */
export type PictureItem =
  | { k: 'text'; text: string; align: Align; bold: boolean; size: TextSize }
  | {
      k: 'row';
      left: string;
      right: string;
      bold: boolean;
      size: TextSize;
      indent: number;
    }
  | { k: 'rule'; char: string }
  | { k: 'blank' }
  | { k: 'image'; width: number; height: number; data: string }
  | { k: 'qr'; data: string };

export interface PictureJob {
  paperWidthMm: PaperWidthMm;
  items: PictureItem[];
  cut: boolean;
  drawer: boolean;
}

// 58 mm heads print 384 dots, 80 mm heads 576 dots; Font A is 12 dots wide.
export const DEFAULT_COLUMNS: Record<PaperWidthMm, number> = { 58: 32, 80: 48 };
export const PAPER_DOTS: Record<PaperWidthMm, number> = { 58: 384, 80: 576 };

/** A 1-bit picture for the printer (see EscposWriter.logos). */
export interface RasterImage {
  width: number;
  height: number;
  data: Buffer;
}

/**
 * Resize a 1-bit picture to `rows` tall (nearest neighbour, aspect kept),
 * at most `maxWidth` dots wide; the width is rounded up to whole bytes.
 */
export function scaleRaster(
  img: RasterImage,
  rows: number,
  maxWidth: number,
): RasterImage {
  const f = Math.min(rows / img.height, maxWidth / img.width);
  const height = Math.max(1, Math.round(img.height * f));
  const drawn = Math.max(1, Math.min(maxWidth, Math.round(img.width * f)));
  const width = Math.min(
    Math.max(8, Math.ceil(drawn / 8) * 8),
    Math.max(8, maxWidth),
  );
  if (height === img.height && width === img.width) return img;
  const srcBytes = img.width / 8;
  const outBytes = width / 8;
  const data = Buffer.alloc(outBytes * height);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(img.height - 1, Math.floor(y / f));
    for (let x = 0; x < drawn; x++) {
      const sx = Math.min(img.width - 1, Math.floor(x / f));
      if (img.data[sy * srcBytes + (sx >> 3)] & (0x80 >> (sx & 7))) {
        data[y * outBytes + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }
  return { width, height, data };
}
export const CODEPAGE_NAMES = Object.keys(CODEPAGES) as CodepageName[];

export function resolveProfile(
  opts: {
    paperWidthMm?: number | null;
    columns?: number | null;
    codepage?: string | null;
  } = {},
): PrinterProfile {
  const paperWidthMm: PaperWidthMm = opts.paperWidthMm === 58 ? 58 : 80;
  const requested = Number(opts.columns);
  const columns =
    Number.isFinite(requested) && requested >= 20 && requested <= 64
      ? Math.floor(requested)
      : DEFAULT_COLUMNS[paperWidthMm];
  const picture = opts.codepage === PICTURE_CODEPAGE;
  const codepage = CODEPAGE_NAMES.includes(opts.codepage as CodepageName)
    ? (opts.codepage as CodepageName)
    : 'CP858';
  return picture
    ? { paperWidthMm, columns, codepage, picture }
    : { paperWidthMm, columns, codepage };
}

const ESC = 0x1b;
const GS = 0x1d;
const SIZE_BYTE: Record<TextSize, number> = {
  normal: 0x00,
  tall: 0x01,
  wide: 0x10,
  big: 0x11,
};
const ALIGN_BYTE: Record<Align, number> = { left: 0, center: 1, right: 2 };

export const CMD = {
  init: Buffer.from([ESC, 0x40]),
  fontA: Buffer.from([ESC, 0x4d, 0x00]),
  boldOn: Buffer.from([ESC, 0x45, 0x01]),
  boldOff: Buffer.from([ESC, 0x45, 0x00]),
  underlineOff: Buffer.from([ESC, 0x2d, 0x00]),
  sizeNormal: Buffer.from([GS, 0x21, 0x00]),
  alignLeft: Buffer.from([ESC, 0x61, 0x00]),
  invertOff: Buffer.from([GS, 0x42, 0x00]),
  // ESC p m t1 t2 - pulse pin 2 for 50 ms on / 500 ms off (cash drawer kick).
  openDrawer: Buffer.from([ESC, 0x70, 0x00, 0x19, 0xfa]),
  cut: Buffer.from([GS, 0x56, 0x00]),
};

// Typographic characters worth keeping legible on a single-byte code page.
const LOOKALIKES: Record<string, string> = {
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"',
  '–': '-',
  '—': '-',
  '…': '...',
  '•': '*',
  '₹': 'Rs.',
  ' ': ' ',
};

export class EscposWriter {
  readonly profile: PrinterProfile;
  /** Distinct characters that could not be represented and were printed as '?'. */
  readonly unsupported = new Set<string>();
  private readonly chunks: Buffer[] = [];
  private readonly reverse = new Map<string, number>();
  /** Picture printing: every line as data (see PrinterProfile.picture). */
  private readonly items: PictureItem[] = [];
  private ending: { cut: boolean; drawer: boolean } = {
    cut: true,
    drawer: false,
  };

  constructor(profile: PrinterProfile) {
    this.profile = profile;
    const high = [...CODEPAGES[profile.codepage].high];
    high.forEach((ch, i) => {
      if (ch !== '�') this.reverse.set(ch, 0x80 + i);
    });
    this.chunks.push(
      CMD.init,
      Buffer.from([ESC, 0x74, CODEPAGES[profile.codepage].escposTable]),
      CMD.fontA,
    );
  }

  /** True if `ch` (one code point) has a byte in the selected code page. */
  has(ch: string): boolean {
    const cp = ch.codePointAt(0)!;
    return (cp >= 0x20 && cp <= 0x7e) || this.reverse.has(ch);
  }

  /**
   * Maps text to printable characters of the selected code page: native
   * glyphs are kept (so Spanish names stay readable), unavailable accents are
   * reduced to their base letter, and anything else becomes '?' and is
   * recorded in `unsupported`. The result is 1 character = 1 byte.
   */
  prepare(text: string | null | undefined): string {
    let out = '';
    for (const ch of String(text ?? '')) {
      if (ch === '\t') out += ' ';
      else if (ch === '\n' || ch === '\r') out += ch === '\n' ? '\n' : '';
      else if (this.has(ch)) out += ch;
      else if (LOOKALIKES[ch] !== undefined) out += LOOKALIKES[ch];
      else {
        const base = ch.normalize('NFKD').replace(/[̀-ͯ]/g, '');
        if (base && base !== ch && [...base].every((c) => this.has(c))) {
          out += base;
        } else if (/\p{C}/u.test(ch)) {
          // control / format characters: nothing to print
        } else {
          out += '?';
          // A picture job prints the original text, so nothing is lost.
          if (!this.profile.picture) this.unsupported.add(ch);
        }
      }
    }
    return out;
  }

  private encode(prepared: string): Buffer {
    const bytes: number[] = [];
    for (const ch of prepared) {
      const cp = ch.codePointAt(0)!;
      bytes.push(
        cp >= 0x20 && cp <= 0x7e ? cp : (this.reverse.get(ch) ?? 0x3f),
      );
    }
    return Buffer.from(bytes);
  }

  /** Characters per line at a text size (double width halves the grid). */
  columnsFor(size: TextSize = 'normal'): number {
    return size === 'wide' || size === 'big'
      ? Math.floor(this.profile.columns / 2)
      : this.profile.columns;
  }

  /** Wraps on spaces, hard-breaking words longer than the line. Never clips. */
  wrap(text: string, columns: number): string[] {
    const lines: string[] = [];
    for (const paragraph of this.prepare(text).split('\n')) {
      let line = '';
      for (const word of paragraph.split(' ').filter((w) => w.length > 0)) {
        let w = word;
        while (w.length > columns) {
          if (line) {
            lines.push(line);
            line = '';
          }
          lines.push(w.slice(0, columns));
          w = w.slice(columns);
        }
        const candidate = line ? `${line} ${w}` : w;
        if (candidate.length > columns) {
          lines.push(line);
          line = w;
        } else {
          line = candidate;
        }
      }
      lines.push(line);
    }
    return lines;
  }

  private emit(
    line: string,
    opts: { align?: Align; bold?: boolean; size?: TextSize },
  ) {
    const { align = 'left', bold = false, size = 'normal' } = opts;
    const styled = bold || size !== 'normal' || align !== 'left';
    if (styled) {
      this.chunks.push(Buffer.from([ESC, 0x61, ALIGN_BYTE[align]]));
      if (bold) this.chunks.push(CMD.boldOn);
      if (size !== 'normal') {
        this.chunks.push(Buffer.from([GS, 0x21, SIZE_BYTE[size]]));
      }
    }
    this.chunks.push(this.encode(line), Buffer.from('\n'));
    if (styled) {
      // Undo per line so a later plain line can never inherit the style.
      if (size !== 'normal') this.chunks.push(CMD.sizeNormal);
      if (bold) this.chunks.push(CMD.boldOff);
      this.chunks.push(CMD.alignLeft);
    }
  }

  /** One or more wrapped lines of text with native alignment / bold / size. */
  text(
    text: string,
    opts: { align?: Align; bold?: boolean; size?: TextSize } = {},
  ): this {
    this.items.push({
      k: 'text',
      text: String(text ?? ''),
      align: opts.align ?? 'left',
      bold: !!opts.bold,
      size: opts.size ?? 'normal',
    });
    for (const l of this.wrap(text, this.columnsFor(opts.size))) {
      this.emit(l, opts);
    }
    return this;
  }

  /**
   * Left label, right-aligned value on one line. A label too long for the
   * line wraps onto further lines; the value is never clipped.
   */
  row(
    label: string,
    value: string,
    opts: { bold?: boolean; size?: TextSize; indent?: number } = {},
  ): this {
    this.items.push({
      k: 'row',
      left: String(label ?? ''),
      right: String(value ?? ''),
      bold: !!opts.bold,
      size: opts.size ?? 'normal',
      indent: opts.indent ?? 0,
    });
    const cols = this.columnsFor(opts.size);
    const v = this.prepare(value);
    const indent = ' '.repeat(opts.indent ?? 0);
    const room = Math.max(1, cols - v.length - 1 - indent.length);
    const parts = this.wrap(label, room);
    const lastIdx = parts.length - 1;
    parts.forEach((part, i) => {
      const left = indent + part;
      const line =
        i === lastIdx
          ? left + ' '.repeat(Math.max(1, cols - left.length - v.length)) + v
          : left;
      this.emit(line, opts);
    });
    return this;
  }

  /**
   * Native ESC/POS QR code (GS ( k, model 2, error correction M), centred. Module size 6 prints a
   * VERI*FACTU-length URL at roughly 33 mm on 203 dpi paper, inside AEAT's 30-40 mm range.
   */
  qr(data: string, moduleSize = 6): this {
    this.items.push({ k: 'qr', data });
    const bytes = Buffer.from(data, 'utf8');
    const len = bytes.length + 3;
    this.chunks.push(
      Buffer.from([ESC, 0x61, 1]),
      Buffer.from([GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]),
      Buffer.from([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, moduleSize]),
      Buffer.from([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31]),
      Buffer.from([GS, 0x28, 0x6b, len & 0xff, len >> 8, 0x31, 0x50, 0x30]),
      bytes,
      Buffer.from([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]),
      Buffer.from('\n'),
      CMD.alignLeft,
    );
    return this;
  }

  /**
   * Logos at the top of a bill: `left` against the left edge and `right`
   * against the right edge of the paper (58 mm = 384 dots, 80 mm = 576), as
   * one GS v 0 raster band, each vertically centred. A logo is a 1-bit
   * picture prepared by Settings › Bill: rows of width/8 bytes, first bit =
   * leftmost dot, 1 = black (width a multiple of 8, so no bit shifting).
   */
  logos(
    leftImage: RasterImage | null,
    rightImage: RasterImage | null,
    opts: { rows?: number; align?: 'top' | 'middle' | 'bottom' } = {},
  ): this {
    const dots = PAPER_DOTS[this.profile.paperWidthMm];
    const rowBytes = dots / 8;
    // Each logo fits half the paper (two side by side), in whole bytes.
    const maxWidth = Math.floor(dots / 2 / 8) * 8 - 8;
    const fit = (img: RasterImage | null) =>
      img ? scaleRaster(img, opts.rows ?? img.height, maxWidth) : null;
    const left = fit(leftImage);
    const right = fit(rightImage);
    const images = [left, right].filter((i): i is RasterImage => !!i);
    if (images.length === 0) return this;
    const height = Math.max(...images.map((i) => i.height));
    const band = Buffer.alloc(rowBytes * height);
    const place = (img: RasterImage, atByte: number) => {
      const imgBytes = Math.min(img.width / 8, rowBytes - atByte);
      const top =
        opts.align === 'top'
          ? 0
          : opts.align === 'bottom'
            ? height - img.height
            : Math.floor((height - img.height) / 2);
      for (let y = 0; y < img.height; y++) {
        img.data.copy(
          band,
          (top + y) * rowBytes + atByte,
          y * (img.width / 8),
          y * (img.width / 8) + imgBytes,
        );
      }
    };
    if (left) place(left, 0);
    if (right) place(right, Math.max(0, rowBytes - right.width / 8));
    this.items.push({
      k: 'image',
      width: dots,
      height,
      data: band.toString('base64'),
    });
    this.chunks.push(
      CMD.alignLeft,
      Buffer.from([
        GS,
        0x76,
        0x30,
        0x00,
        rowBytes & 0xff,
        rowBytes >> 8,
        height & 0xff,
        height >> 8,
      ]),
      band,
      Buffer.from('\n'),
    );
    return this;
  }

  rule(char = '-'): this {
    this.items.push({ k: 'rule', char });
    this.emit(char.repeat(this.profile.columns), {});
    return this;
  }

  blank(n = 1): this {
    for (let i = 0; i < n; i++) {
      this.items.push({ k: 'blank' });
      this.emit('', {});
    }
    return this;
  }

  /**
   * Ends the job: explicit reset of bold / size / alignment / underline /
   * inverse (so nothing leaks into the next job), feed, cut and optionally
   * kick the cash drawer. If any character was printed as '?' a plain notice
   * line says so on the paper itself.
   */
  finish(opts: { cut?: boolean; drawer?: boolean } = {}): Buffer {
    this.ending = { cut: opts.cut !== false, drawer: !!opts.drawer };
    if (this.unsupported.size > 0) {
      this.rule();
      this.text('(!) Some characters could not be printed and show as "?".');
    }
    this.chunks.push(
      CMD.sizeNormal,
      CMD.boldOff,
      CMD.underlineOff,
      CMD.invertOff,
      CMD.alignLeft,
      Buffer.from('\n\n\n\n'),
    );
    if (opts.cut !== false) this.chunks.push(CMD.cut);
    if (opts.drawer) this.chunks.push(CMD.openDrawer);
    return Buffer.concat(this.chunks);
  }

  /** The job as lines to draw, when printing as a picture (call after finish()). */
  pictureJob(): PictureJob | undefined {
    if (!this.profile.picture) return undefined;
    return {
      paperWidthMm: this.profile.paperWidthMm,
      items: this.items,
      ...this.ending,
    };
  }
}
