"use client";

import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { AddIngredientDialog } from "@/components/inventory/add-ingredient-dialog";
import { AdjustStockDialog } from "@/components/inventory/adjust-stock-dialog";
import { InventoryTabs } from "@/components/inventory/inventory-tabs";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useBranch } from "@/hooks/use-branch";
import { useIngredients, useTrackingStatus } from "@/hooks/use-inventory";
import { formatCurrency } from "@/lib/format";

export default function InventoryPage() {
  const { branchId } = useBranch();
  const [search, setSearch] = useState("");
  const { data: ingredients, isLoading } = useIngredients(branchId);
  const { data: trackingStatus } = useTrackingStatus(branchId);

  const filtered = ingredients?.filter((i) =>
    i.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[32px] font-semibold tracking-tight text-foreground">Inventory</h1>
          <p className="text-sm text-muted-foreground">
            Ingredients, recipe costing, purchase orders, and waste
          </p>
        </div>
        <AddIngredientDialog branchId={branchId} />
      </div>

      <InventoryTabs />

      {trackingStatus && trackingStatus.problems.length > 0 && (
        <div role="alert" className="flex gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div className="flex flex-col gap-1">
            <p className="font-medium text-foreground">
              {trackingStatus.problems.length} stock-tracked menu item{trackingStatus.problems.length === 1 ? "" : "s"} will deduct nothing when sold
            </p>
            <p className="text-muted-foreground">
              Add a recipe or pick the stock item (Menu → Edit item → Stock when sold):{" "}
              {trackingStatus.problems.map((p) => p.name).join(", ")}
            </p>
          </div>
        </div>
      )}

      <Input
        placeholder="Search ingredients…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      <Card className="overflow-hidden p-0">
        {isLoading ? (
          <div className="flex flex-col gap-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 rounded-lg" />
            ))}
          </div>
        ) : filtered && filtered.length > 0 ? (
          <>
          {/* Phones: one card per ingredient (the 7-column table ran off the screen). */}
          <ul className="flex flex-col divide-y divide-border md:hidden">
            {filtered.map((i) => {
              const isLow = Number(i.currentStock) <= Number(i.reorderLevel);
              return (
                <li key={i.id} className="flex flex-col gap-2 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="truncate text-base font-semibold text-foreground">{i.name}</span>
                      {isLow && (
                        <Badge variant="destructive" className="w-fit gap-1">
                          <AlertTriangle className="h-3 w-3" />
                          Low stock
                        </Badge>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-lg font-semibold tabular-nums text-foreground">
                        {i.currentStock} <span className="text-sm font-medium text-muted-foreground">{i.unit}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">in stock</p>
                    </div>
                  </div>
                  <dl className="grid grid-cols-3 gap-2 rounded-lg bg-secondary/50 px-3 py-2 text-xs">
                    <div>
                      <dt className="text-muted-foreground">Reorder at</dt>
                      <dd className="font-semibold tabular-nums text-foreground">{i.reorderLevel}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Cost / {i.unit.toLowerCase()}</dt>
                      <dd className="font-semibold tabular-nums text-foreground">{formatCurrency(i.costPerUnit)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Stock value</dt>
                      <dd className="font-semibold tabular-nums text-foreground">
                        {formatCurrency(Number(i.currentStock) * Number(i.costPerUnit))}
                      </dd>
                    </div>
                  </dl>
                  <AdjustStockDialog branchId={branchId} ingredient={i} />
                </li>
              );
            })}
          </ul>
          <div className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ingredient</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="text-right">Current stock</TableHead>
                <TableHead className="text-right">Reorder level</TableHead>
                <TableHead className="text-right">Avg. cost / unit</TableHead>
                <TableHead className="text-right">Stock value</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((i) => {
                const isLow = Number(i.currentStock) <= Number(i.reorderLevel);
                return (
                  <TableRow key={i.id}>
                    <TableCell className="font-medium text-foreground">
                      <div className="flex items-center gap-2">
                        {i.name}
                        {isLow && (
                          <Badge variant="destructive" className="gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            Low stock
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{i.unit}</TableCell>
                    <TableCell className="text-right tabular-nums">{i.currentStock}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {i.reorderLevel}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(i.costPerUnit)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(Number(i.currentStock) * Number(i.costPerUnit))}
                    </TableCell>
                    <TableCell>
                      <AdjustStockDialog branchId={branchId} ingredient={i} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <p className="text-sm font-medium text-foreground">No ingredients yet</p>
            <p className="text-sm text-muted-foreground">
              Add your raw materials to start recipe costing and stock tracking.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
