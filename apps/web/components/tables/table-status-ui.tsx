import type { TableStatusDto } from "@nodedr-restaurant/types";
import { Users } from "lucide-react";
import type { RestaurantTable } from "@/hooks/use-tables";
import { cn } from "@/lib/utils";
import { ElapsedTimer } from "./elapsed-timer";
import { TableShapeIcon } from "./table-shape-icon";

// One look for a table's status everywhere a table is drawn (floor plan, floor
// editor, POS table picker). The name stays in the foreground colour so it is
// always readable; the status colour goes on the top bar, the icon disc and
// the border. Icon greens/ambers use the -700 shades in light mode so they
// stay visible on the pale tint (the -500 shades are too faint as text).
export const TABLE_STATUS_UI: Record<
  TableStatusDto,
  { label: string; tile: string; bar: string; icon: string; dot: string }
> = {
  AVAILABLE: {
    label: "Available",
    tile: "border-emerald-500/30 bg-linear-to-b from-emerald-500/8 to-card hover:border-emerald-500/60",
    bar: "bg-emerald-500",
    icon: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400",
    dot: "bg-emerald-500",
  },
  OCCUPIED: {
    label: "Occupied",
    tile: "border-primary/30 bg-linear-to-b from-primary/10 to-card hover:border-primary/60",
    bar: "bg-primary",
    icon: "bg-primary/12 text-primary",
    dot: "bg-primary",
  },
  RESERVED: {
    label: "Reserved",
    tile: "border-amber-500/35 bg-linear-to-b from-amber-500/10 to-card hover:border-amber-500/60",
    bar: "bg-amber-500",
    icon: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    dot: "bg-amber-500",
  },
  CLEANING: {
    label: "Cleaning",
    tile: "border-border bg-muted/60",
    bar: "bg-muted-foreground/50",
    icon: "bg-muted text-muted-foreground",
    dot: "bg-muted-foreground",
  },
  OUT_OF_SERVICE: {
    label: "Out of service",
    tile: "border-border bg-muted/60 opacity-60",
    bar: "bg-muted-foreground/30",
    icon: "bg-muted text-muted-foreground",
    dot: "bg-muted-foreground",
  },
};

// Shared frame for a table tile: white card, soft status tint, gentle lift on
// hover and a visible keyboard focus ring.
export const TABLE_TILE_BASE =
  "relative flex flex-col items-center justify-center gap-1 rounded-2xl border bg-card shadow-sm outline-none transition-[transform,box-shadow,border-color] duration-200 focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * The inside of a table tile. `compact` fits the floor plan's default 80×80
 * tile: icon, name, and one info line — seats, or for an occupied/reserved
 * table how long it has been so (seats and time together don't fit 80px and
 * used to wrap over the name). The roomier POS picker shows seats and time on
 * separate lines, plus a status pill on large screens.
 */
export function TableTileBody({ table, compact = false }: { table: RestaurantTable; compact?: boolean }) {
  const ui = TABLE_STATUS_UI[table.status];
  const timed = table.status === "OCCUPIED" || table.status === "RESERVED";

  return (
    <>
      <span aria-hidden className={cn("absolute inset-x-4 top-0 rounded-b-full", compact ? "h-[3px]" : "h-1", ui.bar)} />
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full",
          compact ? "size-7" : "size-10 lg:size-12",
          ui.icon,
        )}
      >
        <TableShapeIcon
          shape={table.shape}
          capacity={table.capacity}
          className={compact ? "size-[18px]" : "size-6 lg:size-8"}
        />
      </span>
      <span
        className={cn(
          "max-w-full shrink-0 truncate px-1.5 font-semibold leading-tight text-foreground",
          compact ? "text-sm" : "text-sm lg:text-base",
        )}
      >
        {table.name ?? `T${table.number}`}
      </span>
      {!(compact && timed) && (
        <span className="flex shrink-0 items-center gap-0.5 whitespace-nowrap text-[11px] font-medium text-muted-foreground tabular-nums">
          <Users className="size-3" />
          {table.capacity}
        </span>
      )}
      {timed && (
        <ElapsedTimer
          since={table.statusSince}
          className="flex shrink-0 items-center gap-0.5 whitespace-nowrap text-[11px] font-medium text-muted-foreground tabular-nums"
        />
      )}
      {!compact && (
        <span className="mt-0.5 hidden items-center gap-1 rounded-full bg-background/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground lg:flex">
          <span aria-hidden className={cn("size-1.5 rounded-full", ui.dot)} />
          {ui.label}
        </span>
      )}
    </>
  );
}
