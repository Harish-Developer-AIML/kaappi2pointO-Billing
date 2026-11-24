"use client";

import { LayoutGrid, Plus } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AddFloorDialog } from "@/components/tables/add-floor-dialog";
import { DeleteFloorButton } from "@/components/tables/delete-floor-button";
import { EditableTableTile } from "@/components/tables/editable-table-tile";
import { RenameFloorDialog } from "@/components/tables/rename-floor-dialog";
import { TableEditorDialog } from "@/components/tables/table-editor-dialog";
import { TableTile } from "@/components/tables/table-tile";
import { WaitlistPanel } from "@/components/tables/waitlist-panel";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { BranchNotice } from "@/components/layout/branch-notice";
import { QueryError } from "@/components/ui/query-error";
import { Skeleton } from "@/components/ui/skeleton";
import { ResponsiveTabs } from "@/components/ui/nav-picker";
import { TableRequestsBar } from "@/components/tables/table-requests-bar";
import { hasPermission, useCurrentUser } from "@/hooks/use-auth";
import { useBranch } from "@/hooks/use-branch";
import { useFloors, type RestaurantTable } from "@/hooks/use-tables";
import { cn } from "@/lib/utils";

// Phones/tablets: how tables are shown (see the switch above the tables).
type TablesView = "auto" | "grid" | "floor";
const TABLES_VIEWS: { id: TablesView; label: string }[] = [
  { id: "auto", label: "Auto" },
  { id: "grid", label: "Grid" },
  { id: "floor", label: "Floor plan" },
];
const TABLES_VIEW_KEY = "kaappi.tables.view";
const TABLES_VIEW_EVENT = "kaappi:tables-view";
let memoryView: TablesView = "auto"; // when browser storage is off

function readTablesView(): TablesView {
  try {
    const v = localStorage.getItem(TABLES_VIEW_KEY);
    if (v === "auto" || v === "grid" || v === "floor") return v;
  } catch {
    // storage off: fall back to this tab's choice
  }
  return memoryView;
}

function writeTablesView(v: TablesView) {
  memoryView = v;
  try {
    localStorage.setItem(TABLES_VIEW_KEY, v);
  } catch {
    // not remembered after a reload, still applies now
  }
  window.dispatchEvent(new Event(TABLES_VIEW_EVENT));
}

function subscribeTablesView(onChange: () => void) {
  window.addEventListener(TABLES_VIEW_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(TABLES_VIEW_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export default function TablesPage() {
  const { branchId } = useBranch();
  const { data: me } = useCurrentUser();
  // tables.view is read-only (status updates stay available); layout edits need tables.manage.
  const canManage = hasPermission(me?.user, "tables.manage");
  const floorsQuery = useFloors(branchId);
  const { data: floors } = floorsQuery;
  const { isLoading: branchLoading } = useBranch();
  const isLoading = floorsQuery.isLoading || branchLoading;
  const [activeFloorId, setActiveFloorId] = useState<string | undefined>(undefined);
  const [editModeRequested, setEditMode] = useState(false);
  const editMode = canManage && editModeRequested;
  const [editorTable, setEditorTable] = useState<RestaurantTable | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  // Forces a fresh mount of TableEditorDialog every time it's opened, so its
  // internal form state (number, bulk-mode toggle, etc.) never carries over
  // stale values from a previous open.
  const [editorKey, setEditorKey] = useState(0);

  // On phones the floor plan is shrunk to fit the screen instead of scrolling
  // sideways (view mode only — dragging needs real pixel coordinates).
  const cardRef = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  // A phone turned sideways (short screen): the whole floor plan is also
  // shrunk to the screen height, so every table is in view at once.
  const [fitHeight, setFitHeight] = useState(0);
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      setAvailableWidth(el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
      // Header and bottom bar take about 150 px of a 360-430 px tall screen.
      setFitHeight(window.innerHeight < 600 ? Math.max(160, window.innerHeight - 150) : 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [isLoading, floors?.length]);

  // Phones and tablets: "auto" = tiles upright, floor plan when turned
  // sideways; or always one of them. Remembered on this device.
  const view = useSyncExternalStore(subscribeTablesView, readTablesView, () => "auto" as const);
  const setView = writeTablesView;

  const activeFloor = floors?.find((f) => f.id === (activeFloorId ?? floors[0]?.id));
  const allTables = floors?.flatMap((f) => f.tables) ?? [];
  const availableTables = allTables.filter((t) => t.status === "AVAILABLE");

  const canvasWidth = activeFloor
    ? Math.max(600, ...activeFloor.tables.map((t) => t.posX + t.width + 40))
    : 600;
  const canvasHeight = activeFloor
    ? Math.max(320, ...activeFloor.tables.map((t) => t.posY + t.height + 40))
    : 320;

  const contentWidth = activeFloor
    ? Math.max(1, ...activeFloor.tables.map((t) => t.posX + t.width + 16))
    : canvasWidth;
  const contentHeight = activeFloor
    ? Math.max(1, ...activeFloor.tables.map((t) => t.posY + t.height + 16))
    : canvasHeight;
  const fitScale = editMode
    ? 1
    : Math.min(
        1,
        availableWidth > 0 ? availableWidth / contentWidth : 1,
        fitHeight > 0 ? fitHeight / contentHeight : 1,
      );

  const openAddTable = () => {
    setEditorTable(null);
    setEditorOpen(true);
    setEditorKey((k) => k + 1);
  };
  const openEditTable = (table: RestaurantTable) => {
    setEditorTable(table);
    setEditorOpen(true);
    setEditorKey((k) => k + 1);
  };

  return (
    <div className="flex flex-col gap-6">
      <TableRequestsBar branchId={branchId} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div>
          <h1 className="text-[32px] font-semibold tracking-tight text-foreground">Tables</h1>
          <p className="text-sm text-muted-foreground">
            {editMode
              ? "Drag a table to move it. Tap a table to edit or delete it."
              : "Live floor status — tap a table to update it"}
          </p>
        </div>
        {canManage && floors && floors.length > 0 && (
          <Button variant={editMode ? "default" : "outline"} size="sm" className="h-11 w-full sm:h-8 sm:w-auto" onClick={() => setEditMode((v) => !v)}>
            <LayoutGrid className="h-4 w-4" />
            {editMode ? "Done editing" : "Edit floor plan"}
          </Button>
        )}
      </div>

      {isLoading ? (
        <Skeleton className="h-96 rounded-2xl" />
      ) : floorsQuery.isError && !floors ? (
        <QueryError
          error={floorsQuery.error}
          what="the tables"
          onRetry={() => void floorsQuery.refetch()}
          retrying={floorsQuery.isFetching}
        />
      ) : !branchId ? (
        <BranchNotice />
      ) : floors && floors.length > 0 ? (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_320px]">
          <div className="flex flex-col gap-4">
            {!editMode && (
              <div
                role="radiogroup"
                aria-label="Table view"
                className="flex w-full rounded-xl border border-border bg-secondary/40 p-1 lg:hidden"
              >
                {TABLES_VIEWS.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    role="radio"
                    aria-checked={view === v.id}
                    onClick={() => setView(v.id)}
                    className={cn(
                      "min-h-10 flex-1 rounded-lg px-2 text-sm font-medium transition-colors",
                      view === v.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
                    )}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            )}
            <div className="flex min-w-0 flex-wrap items-center gap-2 [&_button]:max-sm:min-h-10">
              {(floors.length > 1 || editMode) && (
                <ResponsiveTabs
                  className="max-lg:w-full"
                  label="Floor"
                  value={activeFloorId ?? floors[0].id}
                  onChange={setActiveFloorId}
                  items={floors.map((f) => ({ id: f.id, label: f.name }))}
                />
              )}
              {editMode && (
                <>
                  <RenameFloorDialog
                    branchId={branchId}
                    floorId={activeFloor?.id ?? floors[0].id}
                    currentName={activeFloor?.name ?? floors[0].name}
                  />
                  {activeFloor && (
                    <DeleteFloorButton
                      branchId={branchId}
                      floorId={activeFloor.id}
                      floorName={activeFloor.name}
                      tableCount={activeFloor.tables.length}
                      onDeleted={() => setActiveFloorId(undefined)}
                    />
                  )}
                  <AddFloorDialog branchId={branchId} />
                  <Button variant="outline" size="sm" onClick={openAddTable}>
                    <Plus className="h-4 w-4" />
                    Add table
                  </Button>
                </>
              )}
            </div>

            {activeFloor && activeFloor.tables.length === 0 ? (
              // Centred on the page; inside the floor-plan canvas it sat off to
              // the right and was cut off on phones.
              <Card className="flex flex-col items-center gap-3 p-10 text-center">
                <p className="text-base font-semibold text-foreground">No tables on this floor yet</p>
                <p className="text-sm text-muted-foreground">
                  {canManage ? "Add tables to start taking orders at them." : "Ask a manager to add tables."}
                </p>
                {canManage && (
                  <Button className="h-11 font-semibold sm:h-9" onClick={() => { setEditMode(true); openAddTable(); }}>
                    <Plus className="h-4 w-4" />
                    Add table
                  </Button>
                )}
              </Card>
            ) : (
              <>
              {/* Phones (view mode): a grid of full-size tiles. The floor plan,
                  shrunk to fit a phone, made tables tiny and left a large empty
                  area. Editing still uses the floor plan (positions). */}
              {!editMode && (
                <div
                  className={cn(
                    "grid-cols-2 gap-3 min-[420px]:grid-cols-3 lg:hidden",
                    view === "grid" ? "grid" : view === "floor" ? "hidden" : "hidden max-md:portrait:grid",
                  )}
                >
                  {activeFloor?.tables.map((table) => (
                    <TableTile key={table.id} table={table} allTables={allTables} branchId={branchId} layout="grid" />
                  ))}
                </div>
              )}
              <Card
                ref={cardRef}
                className={cn(
                  "overflow-auto p-3 sm:p-6",
                  !editMode && (view === "grid" ? "hidden lg:block" : view === "auto" ? "max-md:portrait:hidden" : ""),
                )}
              >
                <div
                  className="relative"
                  style={
                    fitScale < 1
                      ? { width: Math.min(availableWidth, contentWidth * fitScale), height: contentHeight * fitScale }
                      : { width: canvasWidth, height: canvasHeight, minWidth: "100%" }
                  }
                >
                  <div
                    className="absolute left-0 top-0 origin-top-left"
                    style={{ width: canvasWidth, height: canvasHeight, transform: fitScale < 1 ? `scale(${fitScale})` : undefined }}
                  >
                  {activeFloor?.tables.map((table) =>
                    editMode ? (
                      <EditableTableTile
                        key={table.id}
                        table={table}
                        branchId={branchId}
                        onEdit={() => openEditTable(table)}
                      />
                    ) : (
                      <TableTile
                        key={table.id}
                        table={table}
                        allTables={allTables}
                        branchId={branchId}
                        style={{
                          left: table.posX,
                          top: table.posY,
                          width: table.width,
                          height: table.height,
                        }}
                      />
                    ),
                  )}
                  </div>
                </div>
              </Card>
              </>
            )}

            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
              <Legend color="bg-emerald-500" label="Available" />
              <Legend color="bg-primary" label="Occupied" />
              <Legend color="bg-amber-500" label="Reserved" />
              <Legend color="bg-muted-foreground" label="Cleaning / out of service" />
            </div>
          </div>

          <WaitlistPanel branchId={branchId} availableTables={availableTables} />
        </div>
      ) : (
        <Card className="flex flex-col items-center gap-3 p-16 text-center">
          <p className="text-sm font-medium text-foreground">No floors yet</p>
          <p className="text-sm text-muted-foreground">{canManage ? "Add your first floor to start building the layout." : "Ask a manager to set up the floor plan."}</p>
          {canManage && <AddFloorDialog branchId={branchId} />}
        </Card>
      )}

      {activeFloor && (
        <TableEditorDialog
          key={editorKey}
          branchId={branchId}
          floorId={activeFloor.id}
          table={editorTable}
          open={editorOpen}
          onOpenChange={setEditorOpen}
        />
      )}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
      {label}
    </div>
  );
}
