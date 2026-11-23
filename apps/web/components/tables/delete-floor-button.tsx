"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useDeleteFloor } from "@/hooks/use-tables";
import { ApiError } from "@/lib/api";

/** "Delete floor" in the floor-plan editor: removes the floor and its tables. */
export function DeleteFloorButton({
  branchId,
  floorId,
  floorName,
  tableCount,
  onDeleted,
}: {
  branchId: string | null;
  floorId: string;
  floorName: string;
  tableCount: number;
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const deleteFloor = useDeleteFloor(branchId);

  const confirm = () =>
    deleteFloor.mutate(floorId, {
      onSuccess: () => {
        toast.success(`${floorName} deleted`);
        setOpen(false);
        onDeleted();
      },
      onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not delete the floor"),
    });

  return (
    <>
      <Button variant="outline" size="sm" className="text-destructive" onClick={() => setOpen(true)}>
        <Trash2 className="h-4 w-4" />
        Delete floor
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Delete ${floorName}?`}
        description={
          tableCount > 0
            ? `Its ${tableCount} table${tableCount === 1 ? "" : "s"} will be deleted too. Past bills are kept.`
            : "This floor has no tables."
        }
        confirmLabel="Delete floor"
        pending={deleteFloor.isPending}
        onConfirm={confirm}
      />
    </>
  );
}
