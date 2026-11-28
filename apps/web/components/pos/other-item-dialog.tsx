"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency } from "@/lib/format";

/**
 * "Other item": something sold today that isn't on the menu (a daily special,
 * a one-off). Name, price and quantity go on this bill only; the menu is not
 * changed. The order line carries its own name and price (openItemName).
 */
export function OtherItemDialog({
  onAdd,
  trigger,
}: {
  onAdd: (name: string, price: number, quantity: number) => void;
  /** The button that opens it (default: a full-width dashed button for the cart). */
  trigger?: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState("1");

  const p = Number(price);
  const q = Math.floor(Number(quantity));
  const valid = name.trim().length > 0 && price.trim() !== "" && Number.isFinite(p) && p >= 0 && p <= 1_000_000 && q >= 1 && q <= 999;

  const reset = () => {
    setName("");
    setPrice("");
    setQuantity("1");
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    onAdd(name.trim().slice(0, 60), Math.round(p * 100) / 100, q);
    toast.success(`${q} × ${name.trim()} added to the bill`);
    setOpen(false);
    reset();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger
        render={
          trigger ?? (
            <Button type="button" variant="outline" className="h-11 w-full border-dashed font-semibold">
              <Plus className="h-4 w-4" />
              Other item (not on the menu)
            </Button>
          )
        }
      />
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Other item</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">For this bill only. It is not added to the menu.</p>
          <div className="flex flex-col gap-2">
            <Label htmlFor="other-name">Item name</Label>
            <Input
              id="other-name"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Today's special vada"
              autoFocus
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="other-price">Price (each)</Label>
              <Input
                id="other-price"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0.00"
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="other-qty">Quantity</Label>
              <Input
                id="other-qty"
                type="number"
                inputMode="numeric"
                min={1}
                max={999}
                step={1}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                required
              />
            </div>
          </div>
          {valid && (
            <p className="text-sm text-muted-foreground">
              Line total: <span className="font-semibold text-foreground">{formatCurrency(p * q)}</span>
            </p>
          )}
          <DialogFooter>
            <Button type="submit" className="h-11 w-full font-semibold" disabled={!valid}>
              Add to bill
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
