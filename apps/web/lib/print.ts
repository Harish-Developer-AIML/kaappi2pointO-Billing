// Ported from nodedr-pos's frontend/lib/print.ts: loads the backend's
// self-printing receipt HTML into a hidden same-page iframe rather than a
// new tab, so there's no blank/finished tab left for the cashier to notice
// and close. The OS print dialog still opens exactly as it would for any
// other page (any printer, or "Save as PDF").
let printFrame: HTMLIFrameElement | null = null;

function getPrintFrame(): HTMLIFrameElement {
  if (printFrame) return printFrame;
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  // Positioned far off-screen rather than display:none/width:0 — a 0-width
  // frame forces the browser to lay out the receipt at 0px before printing,
  // clipping the right-aligned amount columns. A real box lets it lay out
  // normally; the huge negative offset keeps it invisible without affecting
  // page layout.
  frame.style.position = "fixed";
  frame.style.top = "-10000px";
  frame.style.left = "-10000px";
  frame.style.width = "380px";
  frame.style.height = "600px";
  frame.style.border = "none";
  document.body.appendChild(frame);
  printFrame = frame;
  return frame;
}

/**
 * Inside the Kaappi Biller Android app, window.print() does nothing (Android's
 * WebView has no print dialog). The app exposes this bridge instead: it loads
 * the URL and opens Android's print screen (any installed printer, or "Save as
 * PDF" to download the bill). See apps/android/src/.../PrintBridge.java.
 */
interface AndroidPrintBridge {
  printUrl(url: string, jobName: string): void;
  // Bluetooth thermal printer paired with this device (app 1.2.0+).
  printEscpos?(base64: string, callbackId: string): void;
  listBluetoothPrinters?(): string;
  getBluetoothPrinter?(): string;
  setBluetoothPrinter?(address: string, name: string): void;
  openBluetoothSettings?(): void;
}

function androidBridge(): AndroidPrintBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as unknown as { KaappiAndroid?: AndroidPrintBridge }).KaappiAndroid;
  return bridge && typeof bridge.printUrl === "function" ? bridge : null;
}

export interface BluetoothPrinter {
  name: string;
  address: string;
}

/** The Android app can drive a Bluetooth printer here (false in a browser or an older app). */
export function canPrintBluetooth(): boolean {
  return typeof androidBridge()?.printEscpos === "function";
}

/** Printers paired with this device in Android's Bluetooth settings. */
export function listBluetoothPrinters(): BluetoothPrinter[] {
  try {
    return JSON.parse(androidBridge()?.listBluetoothPrinters?.() || "[]") as BluetoothPrinter[];
  } catch {
    return [];
  }
}

/** The printer this device prints to (kept in the app, per device). */
export function getBluetoothPrinter(): BluetoothPrinter | null {
  try {
    const raw = androidBridge()?.getBluetoothPrinter?.();
    return raw ? (JSON.parse(raw) as BluetoothPrinter) : null;
  } catch {
    return null;
  }
}

export function setBluetoothPrinter(printer: BluetoothPrinter) {
  androidBridge()?.setBluetoothPrinter?.(printer.address, printer.name);
}

export function openBluetoothSettings() {
  androidBridge()?.openBluetoothSettings?.();
}

let printCallbackSeq = 0;

/**
 * Send a print job (ESC/POS bytes from the server, base64) to this device's
 * Bluetooth printer through the Android app. Resolves once the printer took
 * the data; rejects with a readable reason (no printer chosen, Bluetooth off,
 * printer off or out of range).
 */
export function printEscposViaBluetooth(base64: string): Promise<void> {
  const bridge = androidBridge();
  if (!bridge?.printEscpos) {
    return Promise.reject(
      new Error("Bluetooth printing works in the Kaappi Biller Android app on the phone the printer is paired with."),
    );
  }
  const id = `p${Date.now()}_${++printCallbackSeq}`;
  return new Promise<void>((resolve, reject) => {
    const w = window as unknown as { __kaappiPrintDone?: (id: string, error: string) => void };
    const previous = w.__kaappiPrintDone;
    const timer = setTimeout(() => finish(id, "The printer did not answer. Check it is on and near this phone."), 30000);
    function finish(doneId: string, error: string) {
      if (doneId !== id) return previous?.(doneId, error);
      clearTimeout(timer);
      w.__kaappiPrintDone = previous;
      if (error) reject(new Error(error));
      else resolve();
    }
    w.__kaappiPrintDone = finish;
    bridge.printEscpos!(base64, id);
  });
}

function printPage(path: string, jobName: string) {
  const bridge = androidBridge();
  if (bridge) {
    bridge.printUrl(new URL(path, window.location.origin).toString(), jobName);
    return;
  }
  const frame = getPrintFrame();
  frame.onload = () => {
    const win = frame.contentWindow;
    if (!win) return;
    try {
      win.focus();
      win.print();
    } catch {
      win.postMessage("print", "*");
    }
  };
  frame.src = path;
}

/** Bill figures the cashier has typed but not yet saved (see receipt route). */
export type BillQuery = Record<string, string | number | undefined>;

export function billQueryString(adj: BillQuery = {}): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(adj)) {
    if (v !== undefined && v !== "" && v !== 0) q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `&${s}` : "";
}

/** Browser print of the bill (open order) or receipt (paid order). Read-only. */
export function openReceiptPrint(orderId: string, branchId: string, adj: BillQuery = {}) {
  // `t` forces a reload even if printing the same order twice in a row.
  printPage(
    `/api/v1/orders/${orderId}/receipt?branchId=${branchId}${billQueryString(adj)}&t=${Date.now()}`,
    `Bill ${orderId.slice(-6)}`,
  );
}

export function openKotPrint(orderId: string, branchId: string) {
  printPage(`/api/v1/orders/${orderId}/kot?branchId=${branchId}&t=${Date.now()}`, `Kitchen ticket ${orderId.slice(-6)}`);
}
