"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { ApiError, api } from "@/lib/api";
import { billQueryString, printEscposViaBluetooth, type BillQuery } from "@/lib/print";
import { picturesToEscposBase64, type PictureJob } from "@/lib/print-picture";

export interface PrinterDiagnostics {
  connection: "USB" | "NETWORK" | "BLUETOOTH";
  network: { host: string; port: number; reachable: boolean; error: string | null } | null;
  lpDevices: string[];
  libusbPrinter: { vendorId: number; productId: number; id: string } | null;
  canPrint: boolean;
  notes: string[];
}

export function usePrinterDiagnostics(branchId?: string | null) {
  return useQuery({
    queryKey: ["print", "diagnostics", branchId ?? null],
    queryFn: () => api.get<PrinterDiagnostics>(`/orders/print/diagnostics${branchId ? `?branchId=${branchId}` : ""}`),
    refetchOnWindowFocus: false,
  });
}

export interface PrintJobResult {
  ok: true;
  /** Characters the printer's code page cannot print (shown as "?" on paper). */
  unsupportedChars?: string[];
  /** Bluetooth printer: the job's ESC/POS bytes, printed by the Android app. */
  escpos?: string;
  /** Picture printing (Tamil etc.): lines this device draws and prints. */
  pictures?: PictureJob[];
  pictureVia?: "bluetooth" | "server";
}

interface Deliverable {
  escpos?: string;
  pictures?: PictureJob[];
  pictureVia?: "bluetooth" | "server";
}

/**
 * A Bluetooth printer is paired with the device showing the app, so the server
 * returns the job instead of printing it; send it on from here.
 */
async function deliver<T extends Deliverable>(res: T, branchId?: string | null): Promise<T> {
  let escpos = res.escpos;
  try {
    if (res.pictures?.length) {
      // Picture printing: draw here with this device's fonts (Tamil, ₹ …).
      const drawn = picturesToEscposBase64(res.pictures);
      if (res.pictureVia === "server") {
        await api.post(`/orders/print/raw${branchId ? `?branchId=${branchId}` : ""}`, { escpos: drawn });
        return res;
      }
      escpos = drawn;
    }
    if (escpos) await printEscposViaBluetooth(escpos);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    // As an ApiError so every print button's toast shows the reason
    // ("Bluetooth is off…", "No Bluetooth printer chosen…").
    throw new ApiError(err instanceof Error ? err.message : "Printing failed", 0, undefined, "CLIENT_PRINT");
  }
  return res;
}

/** kind "kot" prints a sample kitchen ticket instead of the receipt test slip. */
export function usePrintTestSlip(branchId?: string | null, kind?: "kot") {
  return useMutation({
    mutationFn: async () =>
      deliver(
        await api.post<{ ok: true } & Deliverable>(
          `/orders/print/test?${[branchId ? `branchId=${branchId}` : "", kind ? `kind=${kind}` : ""].filter(Boolean).join("&")}`,
        ),
        branchId,
      ),
  });
}

/**
 * `drawer` also kicks the cash drawer — pass true when the bill was paid in
 * cash. `adjustments` prices a not-yet-paid bill the way the screen shows it;
 * a bill printed before payment never opens the drawer.
 */
export function usePrintOrderUsb(branchId: string | null) {
  return useMutation({
    mutationFn: async ({ orderId, drawer, adjustments }: { orderId: string; drawer?: boolean; adjustments?: BillQuery }) =>
      deliver(
        await api.post<PrintJobResult>(
          `/orders/${orderId}/print/usb?branchId=${branchId}${drawer ? "&drawer=true" : ""}${billQueryString(adjustments)}`,
        ),
        branchId,
      ),
  });
}

export interface KotPrintResult extends PrintJobResult {
  printed: { id: string; ticketNumber: string; reprint: number }[];
}

/**
 * Kitchen tickets to the thermal printer (native text, no prices). Without
 * `reprint` only tickets not yet printed go out and a repeat answers
 * ALREADY_PRINTED; `reprint: true` prints another copy stamped REPRINT.
 */
export function usePrintKot(branchId: string | null) {
  return useMutation({
    mutationFn: async ({ orderId, reprint }: { orderId: string; reprint?: boolean }) =>
      deliver(
        await api.post<KotPrintResult>(`/orders/${orderId}/print/kot?branchId=${branchId}${reprint ? "&reprint=true" : ""}`),
        branchId,
      ),
  });
}

export function useOpenCashDrawer() {
  return useMutation({
    mutationFn: async (branchId?: string | null) =>
      deliver(
        await api.post<{ ok: true } & Deliverable>(`/orders/print/drawer${branchId ? `?branchId=${branchId}` : ""}`),
        branchId,
      ),
  });
}
