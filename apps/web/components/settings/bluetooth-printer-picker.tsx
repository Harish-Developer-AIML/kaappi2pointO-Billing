"use client";

import { Bluetooth, Check, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  canPrintBluetooth,
  getBluetoothPrinter,
  listBluetoothPrinters,
  openBluetoothSettings,
  setBluetoothPrinter,
  type BluetoothPrinter,
} from "@/lib/print";
import { cn } from "@/lib/utils";

/**
 * Bluetooth thermal printer for THIS phone/tablet: pick one of the printers
 * paired in Android's Bluetooth settings. The choice is kept in the app on this
 * device (each device prints to the printer next to it).
 */
export function BluetoothPrinterPicker() {
  // Read once on mount (the bridge is synchronous and per device).
  const [available] = useState(canPrintBluetooth);
  const [printers, setPrinters] = useState<BluetoothPrinter[]>(() => (available ? listBluetoothPrinters() : []));
  const [chosen, setChosen] = useState<BluetoothPrinter | null>(() => (available ? getBluetoothPrinter() : null));

  if (!available) {
    return (
      <p className="rounded-lg bg-secondary/60 px-3 py-2 text-sm text-muted-foreground">
        Bluetooth printers are chosen in the Kaappi Biller Android app on the phone or tablet the printer is paired with.
        Open this page there.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-sm">
        <Bluetooth className="h-4 w-4 text-primary" />
        {chosen ? (
          <span className="text-foreground">
            This phone prints to <strong className="font-semibold">{chosen.name}</strong>
          </span>
        ) : (
          <span className="text-destructive">No printer chosen on this phone yet</span>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">Paired printers</span>
          <Button variant="ghost" size="sm" onClick={() => setPrinters(listBluetoothPrinters())}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
        {printers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No paired Bluetooth devices. Turn the printer on, pair it in Bluetooth settings (PIN is usually 0000 or
            1234), then tap Refresh.
          </p>
        ) : (
          printers.map((p) => {
            const active = chosen?.address === p.address;
            return (
              <button
                key={p.address}
                type="button"
                onClick={() => {
                  setBluetoothPrinter(p);
                  setChosen(p);
                }}
                className={cn(
                  "flex min-h-12 items-center justify-between gap-3 rounded-xl border-2 px-3 text-left",
                  active ? "border-primary bg-primary/5" : "border-border hover:border-primary/40",
                )}
              >
                <span className="flex flex-col">
                  <span className="text-sm font-semibold text-foreground">{p.name || "Unnamed device"}</span>
                  <span className="font-mono text-xs text-muted-foreground">{p.address}</span>
                </span>
                {active && <Check className="h-5 w-5 text-primary" />}
              </button>
            );
          })
        )}
        <Button variant="outline" className="h-11" onClick={openBluetoothSettings}>
          Pair a new printer
        </Button>
      </div>
    </div>
  );
}
