"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  useDeleteTable,
  useUpdateTableLayout,
  type RestaurantTable,
} from "@/hooks/use-tables";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { TABLE_TILE_BASE, TableTileBody } from "./table-status-ui";

export function EditableTableTile({
  table,
  branchId,
  onEdit,
}: {
  table: RestaurantTable;
  branchId: string | null;
  onEdit: () => void;
}) {
  const updateLayout = useUpdateTableLayout(branchId);
  const deleteTable = useDeleteTable(branchId);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const dragStart = useRef<{ pointerX: number; pointerY: number; posX: number; posY: number } | null>(
    null,
  );

  const posX = dragPos?.x ?? table.posX;
  const posY = dragPos?.y ?? table.posY;

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStart.current = { pointerX: e.clientX, pointerY: e.clientY, posX: table.posX, posY: table.posY };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragStart.current) return;
    const { pointerX, pointerY, posX: startX, posY: startY } = dragStart.current;
    setDragPos({
      x: Math.max(0, startX + (e.clientX - pointerX)),
      y: Math.max(0, startY + (e.clientY - pointerY)),
    });
  };

  const onPointerUp = () => {
    if (!dragStart.current || !dragPos) {
      dragStart.current = null;
      return;
    }
    dragStart.current = null;
    updateLayout.mutate(
      [
        {
          id: table.id,
          posX: dragPos.x,
          posY: dragPos.y,
          width: table.width,
          height: table.height,
          rotation: table.rotation,
        },
      ],
      { onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not save position") },
    );
    setDragPos(null);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Delete ${table.name ?? `Table ${table.number}`}?`)) return;
    deleteTable.mutate(table.id, {
      onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not delete table"),
    });
  };

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className={cn(
        TABLE_TILE_BASE,
        "absolute cursor-grab touch-none gap-0.5 border-2 border-dashed border-primary/40 pt-1 active:cursor-grabbing",
      )}
      style={{ left: posX, top: posY, width: table.width, height: table.height }}
    >
      <TableTileBody table={table} compact />
      <div className="absolute -top-3 right-1 flex gap-1">
        <Button
          variant="secondary"
          size="icon"
          className="h-6 w-6 shadow"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
        >
          <Pencil className="h-3 w-3" />
        </Button>
        <Button
          variant="secondary"
          size="icon"
          className="h-6 w-6 text-destructive shadow"
          onClick={handleDelete}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
