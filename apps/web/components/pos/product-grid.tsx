"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { OtherItemDialog } from "@/components/pos/other-item-dialog";
import { Input } from "@/components/ui/input";
import { QueryError } from "@/components/ui/query-error";
import { Skeleton } from "@/components/ui/skeleton";
import { useCategories, useMenuItems, type MenuItem } from "@/hooks/use-menu";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

export function ProductGrid({
  branchId,
  onSelect,
  onAddOther,
}: {
  branchId: string | null;
  onSelect: (item: MenuItem) => void;
  /** "Other item" (not on the menu): a chip after the last category. */
  onAddOther?: (name: string, price: number, quantity: number) => void;
}) {
  const { data: categories } = useCategories(branchId);
  const [activeCategoryId, setActiveCategoryId] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState("");
  const { data: items, isLoading, isError, error, refetch, isFetching } = useMenuItems(branchId, activeCategoryId);

  const filtered = items?.filter((i) => i.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="flex h-full flex-col gap-4">
      <Input
        placeholder="Search menu…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="h-11"
      />

      {categories && categories.length > 0 && (
        // Phones and tablets: one swipeable row of large category chips, one
        // tap to switch. (Was a dropdown: two taps and a small list.)
        <nav
          aria-label="Category"
          className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] lg:hidden [&::-webkit-scrollbar]:hidden"
        >
          {[{ id: undefined as string | undefined, name: "All", count: undefined as number | undefined }, ...categories.map((c) => ({ id: c.id as string | undefined, name: c.name, count: c._count.items as number | undefined }))].map((c) => {
            const active = c.id === activeCategoryId;
            return (
              <button
                key={c.id ?? "all"}
                type="button"
                aria-current={active ? "true" : undefined}
                onClick={() => setActiveCategoryId(c.id)}
                className={cn(
                  "flex h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-4 text-[15px] transition-colors",
                  active
                    ? "border-primary bg-primary font-semibold text-primary-foreground shadow-sm"
                    : "border-border bg-card font-medium text-foreground active:bg-secondary",
                )}
              >
                {c.name}
                {c.count !== undefined && (
                  <span className={cn("text-xs tabular-nums", active ? "opacity-80" : "text-muted-foreground")}>{c.count}</span>
                )}
              </button>
            );
          })}
          {onAddOther && (
            <OtherItemDialog
              onAdd={onAddOther}
              trigger={
                <button
                  type="button"
                  className="flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-dashed border-primary/50 bg-card px-4 text-[15px] font-semibold text-primary active:bg-secondary"
                >
                  <Plus className="h-4 w-4" />
                  Other item
                </button>
              }
            />
          )}
        </nav>
      )}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row lg:gap-5">
      {categories && categories.length > 0 && (
        <nav
          aria-label="Category"
          className="hidden w-44 shrink-0 flex-col gap-1 overflow-y-auto overscroll-contain border-r border-border pr-3 lg:flex xl:w-52"
        >
          {[{ id: undefined as string | undefined, name: "All", count: undefined as number | undefined }, ...categories.map((c) => ({ id: c.id as string | undefined, name: c.name, count: c._count.items as number | undefined }))].map((c) => {
            const active = c.id === activeCategoryId;
            return (
              <button
                key={c.id ?? "all"}
                type="button"
                aria-current={active ? "true" : undefined}
                onClick={() => setActiveCategoryId(c.id)}
                className={cn(
                  "flex min-h-10 items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                  active
                    ? "bg-primary font-semibold text-primary-foreground shadow-sm"
                    : "font-medium text-foreground hover:bg-secondary",
                )}
              >
                <span className="min-w-0 break-words leading-tight">{c.name}</span>
                {c.count !== undefined && (
                  <span className={cn("shrink-0 text-xs tabular-nums", active ? "opacity-80" : "text-muted-foreground")}>
                    {c.count}
                  </span>
                )}
              </button>
            );
          })}
          {onAddOther && (
            <OtherItemDialog
              onAdd={onAddOther}
              trigger={
                <button
                  type="button"
                  className="mt-1 flex min-h-10 items-center gap-1.5 rounded-lg border border-dashed border-primary/50 px-3 py-2 text-left text-sm font-semibold text-primary hover:bg-secondary"
                >
                  <Plus className="h-4 w-4" />
                  Other item
                </button>
              }
            />
          )}
        </nav>
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {isError && !items ? (
        <QueryError error={error} what="the menu" onRetry={() => void refetch()} retrying={isFetching} />
      ) : (
      <div className="-m-1.5 grid flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-3 overflow-y-auto overscroll-contain p-1.5 pb-4 lg:gap-4">
        {/* Columns follow the space this grid actually has, not the viewport:
            on the POS page it shares the row with the category rail and the
            cart, so viewport breakpoints (xl:grid-cols-4) squeezed cards
            narrower than a name or a price. Each card is at least 8rem.
            p-1.5 (cancelled by -m-1.5) keeps a card's hover lift and shadow
            inside the scroll box instead of being clipped at its edge. */}
        {isLoading &&
          Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
        {filtered?.map((item) => (
          <button
            key={item.id}
            onClick={() => onSelect(item)}
            className="flex min-h-24 flex-col items-start gap-2 rounded-2xl border border-border bg-card p-3 text-left sm:p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md active:scale-[0.97] active:translate-y-0 lg:min-h-32 lg:justify-between lg:p-4 lg:hover:border-primary/50"
          >
            <span
              className={`h-2.5 w-2.5 rounded-full ${item.isVeg ? "bg-success" : "bg-destructive"}`}
            />
            <span className="w-full break-words text-sm font-medium leading-tight text-foreground lg:text-[15px]">{item.name}</span>
            <span className="flex w-full flex-wrap items-baseline justify-between gap-x-2">
              <span className="whitespace-nowrap text-sm font-semibold tabular-nums text-foreground lg:text-base">
                {formatCurrency(item.price)}
              </span>
              {item.halfPrice != null && (
                <span className="hidden text-[11px] tabular-nums text-muted-foreground lg:inline">
                  Half {formatCurrency(item.halfPrice)}
                </span>
              )}
            </span>
          </button>
        ))}
        {filtered?.length === 0 && !isLoading && (
          <p className="col-span-full py-10 text-center text-sm text-muted-foreground">
            {search ? <>No items match &quot;{search}&quot;</> : "No items in this category yet"}
          </p>
        )}
      </div>
      )}
      </div>
      </div>
    </div>
  );
}
