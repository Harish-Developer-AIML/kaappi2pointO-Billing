import { BILL_LOGO_MAX_DOTS, type BillLogo } from "@nodedr-restaurant/types";

// Settings › Bill logos are prepared here, in the browser, when chosen: the
// server (also the phone's own server) has no image library. See
// billLogoSchema in packages/types/src/bill-settings.ts for the format.

/** Longest side of the screen/PDF image (shown at 16 mm on the bill). */
const SCREEN_MAX_PX = 192;
/** Printed logo height: 120 dots = 15 mm on a 203 dpi thermal printer. */
const PRINT_MAX_ROWS = 120;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("This image could not be read. Use a PNG or JPG file."));
    };
    img.src = url;
  });
}

function canvas(width: number, height: number) {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("This browser cannot prepare images.");
  return { c, ctx };
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Image file → logo for the bill (screen PNG + 1-bit printer picture). */
export async function makeBillLogo(file: File): Promise<BillLogo> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file (PNG or JPG).");
  if (file.size > 10_000_000) throw new Error("The image is over 10 MB. Use a smaller one.");
  const img = await loadImage(file);
  const w0 = img.naturalWidth;
  const h0 = img.naturalHeight;
  if (!w0 || !h0) throw new Error("This image is empty.");

  // Screen/PDF version: transparent PNG, at most 192 px on the long side.
  const s = Math.min(1, SCREEN_MAX_PX / Math.max(w0, h0));
  const screen = canvas(Math.max(1, Math.round(w0 * s)), Math.max(1, Math.round(h0 * s)));
  screen.ctx.drawImage(img, 0, 0, screen.c.width, screen.c.height);
  const image = screen.c.toDataURL("image/png");

  // Printer version: on white, fits 184 x 120 dots, width a multiple of 8.
  const p = Math.min(BILL_LOGO_MAX_DOTS / w0, PRINT_MAX_ROWS / h0);
  const pw = Math.max(1, Math.round(w0 * p));
  const height = Math.max(1, Math.round(h0 * p));
  const width = Math.min(BILL_LOGO_MAX_DOTS, Math.ceil(pw / 8) * 8);
  const print = canvas(width, height);
  print.ctx.fillStyle = "#fff";
  print.ctx.fillRect(0, 0, width, height);
  print.ctx.drawImage(img, Math.floor((width - pw) / 2), 0, pw, height);
  const { data } = print.ctx.getImageData(0, 0, width, height);

  // Grey levels, then Floyd–Steinberg dithering to black/white dots.
  const grey = new Float32Array(width * height);
  for (let i = 0; i < grey.length; i++) {
    grey[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }
  const rowBytes = width / 8;
  const bits = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const black = grey[i] < 128;
      if (black) bits[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
      const err = grey[i] - (black ? 0 : 255);
      if (x + 1 < width) grey[i + 1] += (err * 7) / 16;
      if (y + 1 < height) {
        if (x > 0) grey[i + width - 1] += (err * 3) / 16;
        grey[i + width] += (err * 5) / 16;
        if (x + 1 < width) grey[i + width + 1] += err / 16;
      }
    }
  }
  return { image, raster: { width, height, data: toBase64(bits) } };
}

/** The printer picture drawn back as an image: how the logo comes out on thermal paper. */
export function rasterPreview(raster: BillLogo["raster"]): string {
  const bytes = Uint8Array.from(atob(raster.data), (ch) => ch.charCodeAt(0));
  const { c, ctx } = canvas(raster.width, raster.height);
  const out = ctx.createImageData(raster.width, raster.height);
  const rowBytes = raster.width / 8;
  for (let y = 0; y < raster.height; y++) {
    for (let x = 0; x < raster.width; x++) {
      const black = bytes[y * rowBytes + (x >> 3)] & (0x80 >> (x & 7));
      const o = (y * raster.width + x) * 4;
      out.data[o] = out.data[o + 1] = out.data[o + 2] = black ? 17 : 255;
      out.data[o + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return c.toDataURL("image/png");
}
