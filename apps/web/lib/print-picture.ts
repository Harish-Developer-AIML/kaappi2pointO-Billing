// Picture printing for thermal printers (character set "Tamil / Indian
// languages"). Printers only have Latin code pages built in, so Tamil, Hindi,
// ₹ … cannot be sent as text. The server sends the bill's lines instead
// (PictureJob, apps/backend/src/modules/orders/escpos/encoder.ts); this draws
// them with the device's own fonts (Android has Tamil fonts built in), turns
// the drawing into black/white dots and wraps it in ESC/POS raster commands.

export type PictureItem =
  | { k: "text"; text: string; align: "left" | "center" | "right"; bold: boolean; size: TextSize }
  | { k: "row"; left: string; right: string; bold: boolean; size: TextSize; indent: number }
  | { k: "rule"; char: string }
  | { k: "blank" }
  | { k: "image"; width: number; height: number; data: string }
  | { k: "qr"; data: string };
type TextSize = "normal" | "tall" | "wide" | "big";

export interface PictureJob {
  paperWidthMm: 58 | 80;
  items: PictureItem[];
  cut: boolean;
  drawer: boolean;
}

const DOTS = { 58: 384, 80: 576 } as const;
const FONT = '"Noto Sans Tamil", "Noto Sans", "Nirmala UI", "Latha", Roboto, Arial, sans-serif';
// Font sizes in dots (8 dots = 1 mm): close to the printer's own text sizes.
const FONT_PX: Record<TextSize, number> = { normal: 22, tall: 34, wide: 30, big: 40 };
const GAP = 6; // between lines
const MARGIN = 4; // left/right, in dots

interface Op {
  y: number;
  h: number;
  draw: (ctx: CanvasRenderingContext2D, y: number, width: number) => void;
}

function font(size: TextSize, bold: boolean) {
  return `${bold || size !== "normal" ? "700" : "400"} ${FONT_PX[size]}px ${FONT}`;
}

/** Greedy word wrap by measured width; very long words are split by character. */
function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= max) {
        line = candidate;
        continue;
      }
      if (line) out.push(line);
      line = "";
      let piece = "";
      for (const ch of Array.from(word)) {
        if (ctx.measureText(piece + ch).width > max && piece) {
          out.push(piece);
          piece = ch;
        } else piece += ch;
      }
      line = piece;
    }
    out.push(line);
  }
  return out;
}

/** Lays the job out as drawing steps, top to bottom. */
function layout(ctx: CanvasRenderingContext2D, job: PictureJob, width: number): { ops: Op[]; height: number } {
  const ops: Op[] = [];
  let y = 0;
  const usable = width - MARGIN * 2;
  for (const item of job.items) {
    if (item.k === "text") {
      ctx.font = font(item.size, item.bold);
      const lh = FONT_PX[item.size] + GAP;
      for (const line of wrap(ctx, item.text, usable)) {
        const f = font(item.size, item.bold);
        const align = item.align;
        ops.push({
          y,
          h: lh,
          draw: (c, top) => {
            c.font = f;
            c.textAlign = align;
            const x = align === "center" ? width / 2 : align === "right" ? width - MARGIN : MARGIN;
            c.fillText(line, x, top + lh - GAP - 2);
          },
        });
        y += lh;
      }
    } else if (item.k === "row") {
      ctx.font = font(item.size, item.bold);
      const f = font(item.size, item.bold);
      const lh = FONT_PX[item.size] + GAP;
      const indent = item.indent * (FONT_PX.normal * 0.5);
      const rightW = ctx.measureText(item.right).width;
      const lines = wrap(ctx, item.left, Math.max(40, usable - indent - rightW - 12));
      lines.forEach((line, i) => {
        const last = i === lines.length - 1;
        ops.push({
          y,
          h: lh,
          draw: (c, top) => {
            c.font = f;
            c.textAlign = "left";
            c.fillText(line, MARGIN + indent, top + lh - GAP - 2);
            if (last) {
              c.textAlign = "right";
              c.fillText(item.right, width - MARGIN, top + lh - GAP - 2);
            }
          },
        });
        y += lh;
      });
    } else if (item.k === "rule") {
      const double = item.char === "=";
      ops.push({
        y,
        h: 14,
        draw: (c, top) => {
          c.fillStyle = "#000";
          if (double) {
            c.fillRect(MARGIN, top + 4, width - MARGIN * 2, 2);
            c.fillRect(MARGIN, top + 9, width - MARGIN * 2, 2);
          } else {
            for (let x = MARGIN; x < width - MARGIN; x += 10) c.fillRect(x, top + 6, 6, 2);
          }
        },
      });
      y += 14;
    } else if (item.k === "blank") {
      y += FONT_PX.normal + GAP;
    } else if (item.k === "image") {
      const bytes = Uint8Array.from(atob(item.data), (ch) => ch.charCodeAt(0));
      const rowBytes = item.width / 8;
      const img = item;
      ops.push({
        y,
        h: item.height,
        draw: (c, top) => {
          c.fillStyle = "#000";
          for (let yy = 0; yy < img.height; yy++) {
            for (let x = 0; x < img.width; x++) {
              if (bytes[yy * rowBytes + (x >> 3)] & (0x80 >> (x & 7))) c.fillRect(x, top + yy, 1, 1);
            }
          }
        },
      });
      y += item.height + GAP;
    } else if (item.k === "qr") {
      // Only VERI*FACTU (Spain) prints a QR; not used with Indian scripts.
      ctx.font = font("normal", false);
      const data = item.data;
      for (const line of wrap(ctx, data, usable)) {
        ops.push({
          y,
          h: FONT_PX.normal + GAP,
          draw: (c, top) => {
            c.font = font("normal", false);
            c.textAlign = "left";
            c.fillText(line, MARGIN, top + FONT_PX.normal);
          },
        });
        y += FONT_PX.normal + GAP;
      }
    }
  }
  return { ops, height: Math.max(1, y) };
}

/** Draws a job and returns it as black/white rows (1 bit per dot, 1 = black). */
export function rasterizePictureJob(job: PictureJob): { width: number; height: number; bits: Uint8Array } {
  const width = DOTS[job.paperWidthMm] ?? 576;
  const probe = document.createElement("canvas").getContext("2d");
  if (!probe) throw new Error("This device cannot draw the bill for printing.");
  const { ops, height } = layout(probe, job, width);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#000";
  ctx.textBaseline = "alphabetic";
  for (const op of ops) {
    ctx.fillStyle = "#000";
    op.draw(ctx, op.y, width);
  }
  const { data } = ctx.getImageData(0, 0, width, height);
  const rowBytes = width / 8;
  const bits = new Uint8Array(rowBytes * height);
  for (let i = 0; i < width * height; i++) {
    // Anti-aliased text edges: darker than mid grey prints as a dot.
    const lum = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    if (lum < 150) {
      const x = i % width;
      const yy = (i - x) / width;
      bits[yy * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { width, height, bits };
}

/** ESC/POS bytes for a job: init, the picture in 128-row bands, feed, cut, drawer. */
export function pictureJobToEscpos(job: PictureJob): Uint8Array {
  const { width, height, bits } = rasterizePictureJob(job);
  const rowBytes = width / 8;
  const parts: number[][] = [[0x1b, 0x40]];
  for (let top = 0; top < height; top += 128) {
    const rows = Math.min(128, height - top);
    parts.push([0x1d, 0x76, 0x30, 0x00, rowBytes & 0xff, rowBytes >> 8, rows & 0xff, rows >> 8]);
    parts.push(Array.from(bits.subarray(top * rowBytes, (top + rows) * rowBytes)));
  }
  parts.push([0x0a, 0x0a, 0x0a, 0x0a]);
  if (job.cut) parts.push([0x1d, 0x56, 0x00]);
  if (job.drawer) parts.push([0x1b, 0x70, 0x00, 0x19, 0xfa]);
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Base64 of all jobs one after another (several kitchen tickets). */
export function picturesToEscposBase64(jobs: PictureJob[]): string {
  let s = "";
  for (const job of jobs) {
    const bytes = pictureJobToEscpos(job);
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}
