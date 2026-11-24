// Picks the transport for a branch's thermal printer: USB attached to the
// machine running the backend, a network printer over raw TCP, or (Bluetooth)
// the Android app on the device the printer is paired with.
import { sendViaNetwork } from './escpos-network';
import { PrinterNotFoundError, sendRaw } from './escpos-usb';

export interface BranchPrinterTarget {
  printerConnection: string;
  printerHost: string | null;
  printerPort: number;
}

/**
 * A Bluetooth printer is paired with the Android device running the app, not
 * reachable from the server: print endpoints return the ESC/POS bytes to the
 * app instead (orders.controller deliver(), kot-print.service).
 */
export function printsOnClient(branch: { printerConnection: string }): boolean {
  return branch.printerConnection === 'BLUETOOTH';
}

export async function sendToBranchPrinter(
  branch: BranchPrinterTarget,
  buffer: Buffer,
): Promise<void> {
  if (printsOnClient(branch)) {
    throw new PrinterNotFoundError(
      'Bluetooth printing goes through the Kaappi Biller Android app on the device paired with the printer',
    );
  }
  if (branch.printerConnection === 'NETWORK') {
    if (!branch.printerHost) {
      throw new PrinterNotFoundError(
        'Network printing is selected but no printer address is set - add it in Settings > Printer',
      );
    }
    return sendViaNetwork(
      { host: branch.printerHost, port: branch.printerPort },
      buffer,
    );
  }
  return sendRaw(buffer);
}
