"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { useUpdateTableLayout, type RestaurantTable } from "@/hooks/use-tables";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { TABLE_TILE_BASE, TableTileBody } from "./table-status-ui";

// A finger always wobbles a little: only a move this far (px) is a drag, so a
// tap on a phone opens the table instead of nudging it.
const DRAG_THRESHOLD = 6;

/**
 * A table in the floor-plan editor: drag to move it, tap (or click) to edit
 * or delete it in the table dialog. The old floating edit/delete buttons
 * overlapped each other and the table name on touch screens (44px each on an
 * 80px tile) and were often cut off at the top of the floor plan.
 */
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
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const dragStart = useRef<{ pointerX: number; pointerY: number; posX: number; posY: number } | null>(
    null,
  );
  // Set when a drag ends, so the click the browser fires right after it isn't
  // taken as "open the table".
  const justDragged = useRef(false);

  const posX = dragPos?.x ?? table.posX;
  const posY = dragPos?.y ?? table.posY;

  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStart.current = { pointerX: e.clientX, pointerY: e.clientY, posX: table.posX, posY: table.posY };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragStart.current) return;
    const { pointerX, pointerY, posX: startX, posY: startY } = dragStart.current;
    const dx = e.clientX - pointerX;
    const dy = e.clientY - pointerY;
    if (!dragPos && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    setDragPos({ x: Math.max(0, startX + dx), y: Math.max(0, startY + dy) });
  };

  const onPointerUp = () => {
    if (!dragStart.current) return;
    dragStart.current = null;
    if (!dragPos) return; // a tap: handled by onClick
    justDragged.current = true;
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

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${table.name ?? `Table ${table.number}`}: drag to move, tap to edit or delete`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        dragStart.current = null;
        setDragPos(null);
      }}
      onClick={() => {
        if (justDragged.current) {
          justDragged.current = false;
          return;
        }
        onEdit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onEdit();
        }
      }}
      className={cn(
        TABLE_TILE_BASE,
        "absolute cursor-grab touch-none gap-0.5 border-2 border-dashed border-primary/40 pt-1 active:cursor-grabbing",
      )}
      style={{ left: posX, top: posY, width: table.width, height: table.height }}
    >
      <TableTileBody table={table} compact />
    </div>
  );
}
