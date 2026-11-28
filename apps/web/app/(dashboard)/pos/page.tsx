"use client";

import { ChevronLeft, MonitorSmartphone, ShoppingCart } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { StatusNote, useNoteToast } from "@/components/ui/status-note";
import { publishDisplay } from "@/lib/customer-display";
import { BranchNotice } from "@/components/layout/branch-notice";
import { CartPanel, type DeliveryDetails, type PosOrderType } from "@/components/pos/cart-panel";
import { cartLineKey, portionText, type CartLine, type Portion } from "@/components/pos/cart-line";
import { clearDraft, switchTableDraft, type Drafts } from "@/lib/pos-drafts";
import { CheckoutPanel } from "@/components/pos/checkout-panel";
import { KitchenProgressWidget } from "@/components/pos/kitchen-progress-widget";
import { ModifierPickerDialog } from "@/components/pos/modifier-picker-dialog";
import { PosTablePicker } from "@/components/pos/pos-table-picker";
import { ProductGrid } from "@/components/pos/product-grid";
import { Card } from "@/components/ui/card";
import { useBranch } from "@/hooks/use-branch";
import type { MenuItem } from "@/hooks/use-menu";
import {
  useAddOrderItems,
  useCreateOrder,
  useOpenOrdersForTable,
  useOrder,
  type CreatedOrder,
  type OpenOrder,
} from "@/hooks/use-orders";
import { useFloors, type RestaurantTable } from "@/hooks/use-tables";
import { ApiError } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { OPEN_ITEM_MENU_ID } from "@nodedr-restaurant/types";
import { NO_TABLE, POS_RESET_EVENT } from "@/lib/pos-events";
import { useLandscapePhone } from "@/hooks/use-landscape-phone";
import { cn } from "@/lib/utils";

export default function PosPage() {
  return (
    <Suspense fallback={null}>
      <PosPageInner />
    </Suspense>
  );
}

function PosPageInner() {
  const { branchId, isLoading: branchLoading } = useBranch();
  const { note, clear: clearNote, toast } = useNoteToast();
  const floorsQuery = useFloors(branchId);
  const floors = floorsQuery.data;
  const tables = floors?.flatMap((f) => f.tables) ?? [];
  const preselectedTableId = useSearchParams().get("tableId") ?? "";

  const [lines, setLines] = useState<CartLine[]>([]);
  const [orderType, setOrderType] = useState<PosOrderType>("DINE_IN");
  const [delivery, setDelivery] = useState<DeliveryDetails>({ address: "", pincode: "", phone: "" });
  const [scheduledFor, setScheduledFor] = useState("");
  const [tableId, setTableIdRaw] = useState(preselectedTableId);
  // Unsent cart per table, so switching tables never moves or loses items.
  const [drafts, setDrafts] = useState<Drafts<CartLine>>({});
  const setTableId = (next: string) => {
    if (next === tableId) return;
    const r = switchTableDraft(drafts, tableId, next, lines);
    setDrafts(r.drafts);
    setLines(r.lines);
    setSelectedBillId(null);
    setTableIdRaw(next);
  };
  const [selectedBillId, setSelectedBillId] = useState<string | null>(null);
  const [pickerItem, setPickerItem] = useState<MenuItem | null>(null);
  const [activeOrder, setActiveOrder] = useState<CreatedOrder | null>(null);
  const [activeCustomer, setActiveCustomer] = useState<OpenOrder["customer"]>(null);
  // /pos?tableId=... can change while this page stays mounted.
  const [seenPreselected, setSeenPreselected] = useState(preselectedTableId);
  if (preselectedTableId !== seenPreselected) {
    setSeenPreselected(preselectedTableId);
    if (preselectedTableId && !activeOrder) setTableId(preselectedTableId);
  }
  // Phones show the menu full-screen and the cart/checkout as an overlay; from
  // lg up both sit side by side and this flag is ignored.
  const [cartOpen, setCartOpen] = useState(false);

  // Mirror the cart to the customer-facing display (/customer-display).
  useEffect(() => {
    if (activeOrder) return;
    publishDisplay(
      lines.length === 0
        ? { kind: "idle" }
        : {
            kind: "cart",
            lines: lines.map((l) => ({
              name: l.modifierLabel ? `${l.name} (${l.modifierLabel})` : l.name,
              quantity: l.quantity,
              total: l.unitPrice * l.quantity,
            })),
            subtotal: lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0),
          },
    );
  }, [lines, activeOrder]);

  const createOrder = useCreateOrder(branchId);
  const addOrderItems = useAddOrderItems(branchId);
  const realTableId = orderType === "DINE_IN" && tableId && tableId !== NO_TABLE ? tableId : null;
  const openBillsQuery = useOpenOrdersForTable(branchId, realTableId);
  const existingOrders = openBillsQuery.data;
  // A table can carry several open bills; the user picks which one gets the
  // new items (default: the newest). Until the table's bills are loaded we do
  // not know whether this is a new bill or a new round, so submitting waits.
  const checkingTable = !!realTableId && (openBillsQuery.isPending || openBillsQuery.isFetching);
  const existingOrder =
    existingOrders?.find((o) => o.id === selectedBillId) ?? existingOrders?.[0];
  // The open bill's items, shown in the cart so reopening a table shows its order.
  const existingOrderDetail = useOrder(branchId, existingOrder?.id ?? null).data;

  const addLine = (
    menuItemId: string,
    name: string,
    unitPrice: number,
    modifierIds: string[],
    modifierLabel: string,
    portion?: Portion,
  ) => {
    const key = cartLineKey(menuItemId, modifierIds, portion);
    setLines((prev) => {
      const existing = prev.find((l) => l.key === key);
      if (existing) {
        return prev.map((l) => (l.key === key ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [...prev, { key, menuItemId, name, unitPrice, quantity: 1, modifierIds, modifierLabel, portion }];
    });
  };

  // "Other item": not on the menu, on this bill only. Same name and price
  // again adds to the same line.
  const addOtherItem = (name: string, price: number, quantity: number) => {
    const key = `open::${name.toLowerCase()}::${price}`;
    setLines((prev) => {
      const existing = prev.find((l) => l.key === key);
      if (existing) {
        return prev.map((l) => (l.key === key ? { ...l, quantity: l.quantity + quantity } : l));
      }
      return [
        ...prev,
        { key, menuItemId: OPEN_ITEM_MENU_ID, name, unitPrice: price, quantity, modifierIds: [], openItemName: name },
      ];
    });
  };

  const handleSelect = (item: MenuItem) => {
    if (item.modifierGroups.length > 0 || item.halfPrice != null) {
      setPickerItem(item);
      return;
    }
    addLine(item.id, item.name, Number(item.price), [], "");
  };

  const handleModifierConfirm = (modifierIds: string[], modifierLabel: string, portion?: Portion) => {
    if (!pickerItem) return;
    const modifierTotal = modifierIds.reduce((sum, id) => {
      const mod = pickerItem.modifierGroups
        .flatMap((g) => g.modifierGroup.modifiers)
        .find((m) => m.id === id);
      return sum + (mod ? Number(mod.priceAdjustment) : 0);
    }, 0);
    const base =
      portion?.customPrice ??
      (portion?.kind === "HALF" ? Number(pickerItem.halfPrice) : Number(pickerItem.price));
    addLine(
      pickerItem.id,
      portion ? `${pickerItem.name} (${portionText(portion)})` : pickerItem.name,
      base + modifierTotal,
      modifierIds,
      modifierLabel,
      portion,
    );
  };

  const updateQuantity = (key: string, delta: number) => {
    setLines((prev) =>
      prev
        .map((l) => (l.key === key ? { ...l, quantity: l.quantity + delta } : l))
        .filter((l) => l.quantity > 0),
    );
  };

  const removeLine = (key: string) => setLines((prev) => prev.filter((l) => l.key !== key));

  const handleSubmit = () => {
    if (checkingTable) return;
    const sentTableId = tableId;
    const items = lines.map((l) =>
      l.openItemName
        ? {
            menuItemId: OPEN_ITEM_MENU_ID,
            quantity: l.quantity,
            modifierIds: [],
            openItemName: l.openItemName,
            customPrice: l.unitPrice,
          }
        : {
            menuItemId: l.menuItemId,
            quantity: l.quantity,
            modifierIds: l.modifierIds,
            ...(l.portion
              ? {
                  portion: l.portion.kind,
                  customPrice: l.portion.customPrice,
                  ...(l.portion.kind === "CUSTOM" ? { customLabel: l.portion.customLabel } : {}),
                }
              : {}),
          },
    );

    if (existingOrder) {
      addOrderItems.mutate(
        { orderId: existingOrder.id, dto: { items } },
        {
          onSuccess: (order) => {
            setDrafts((d) => clearDraft(d, sentTableId));
            setActiveCustomer(existingOrder.customer);
            setActiveOrder(order);
            toast.success(`Added to order #${order.orderNumber} — sent to kitchen`);
          },
          onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not add items"),
        },
      );
      return;
    }

    createOrder.mutate(
      {
        type: orderType,
        tableId: realTableId ?? undefined,
        ...(orderType === "DELIVERY" ? { delivery } : {}),
        ...(orderType !== "DINE_IN" && scheduledFor
          ? { scheduledFor: new Date(scheduledFor).toISOString() }
          : {}),
        items,
      },
      {
        onSuccess: (order) => {
          setDrafts((d) => clearDraft(d, sentTableId));
          setActiveCustomer(null);
          setActiveOrder(order);
          setCartOpen(true);
          toast.success(`Order #${order.orderNumber} sent to kitchen`);
        },
        onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not create order"),
      },
    );
  };

  const viewExistingOrder = () => {
    if (existingOrder) {
      setActiveCustomer(existingOrder.customer);
      setActiveOrder(existingOrder);
      setCartOpen(true);
    }
  };

  const resetForNewOrder = () => {
    setActiveOrder(null);
    setCartOpen(false);
    // The sent cart is gone; other tables' unsent drafts stay.
    setLines([]);
    setSelectedBillId(null);
    setTableIdRaw("");
    setActiveCustomer(null);
    setDelivery({ address: "", pincode: "", phone: "" });
    setScheduledFor("");
  };

  const handleTablePick = (table: RestaurantTable) => {
    setTableId(table.id);
    // An occupied table opens straight onto its order (phones: the cart sheet).
    if (table.status === "OCCUPIED") setCartOpen(true);
  };

  // Point of Sale tapped while already here: back to a fresh table list. A
  // sent/paid order is closed; an unsent cart stays saved for its table.
  useEffect(() => {
    const onReset = () => {
      if (activeOrder) {
        resetForNewOrder();
      } else {
        const r = switchTableDraft(drafts, tableId, "", lines);
        setDrafts(r.drafts);
        setLines(r.lines);
        setSelectedBillId(null);
        setTableIdRaw("");
        setCartOpen(false);
      }
      setOrderType("DINE_IN");
    };
    window.addEventListener(POS_RESET_EVENT, onReset);
    return () => window.removeEventListener(POS_RESET_EVENT, onReset);
  });

  // Click-to-order: for a fresh dine-in ticket, land on a visual table grid
  // first — the rest of the flow (menu, cart, bill-or-add-more) is
  // unchanged once a table's picked. Takeaway orders and orders already
  // mid-flow (tableId set, or viewing/paying an order) skip straight past
  // it, same as arriving here from the Tables page's own "New order" link
  // (?tableId=... pre-fills this and never shows the picker).
  const showTablePicker = orderType === "DINE_IN" && !tableId && !activeOrder;
  // Phone turned sideways: menu and cart side by side, like on a computer.
  const sideBySide = useLandscapePhone();

  return (
    <div
      className={cn(
        "flex flex-col gap-4 lg:h-[calc(100dvh-8rem)]",
        // Sideways the screen is short: at least 22rem tall, the page scrolls the rest.
        sideBySide ? "h-[max(22rem,calc(100dvh-8.5rem))] gap-3" : "h-[calc(100dvh-10rem)]",
      )}
    >
      <StatusNote note={note} onClear={clearNote} />
      <div className={cn("flex flex-wrap items-center justify-between gap-2", sideBySide && "hidden")}>
        <div className="min-w-0 flex-1">
          <KitchenProgressWidget branchId={branchId} />
        </div>
        <a
          href="/customer-display"
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          title="Opens the customer-facing screen in a new window — drag it to the second monitor"
        >
          <MonitorSmartphone className="h-3.5 w-3.5" />
          Customer display
        </a>
      </div>

      <BranchNotice />

      {showTablePicker ? (
        <Card className={cn("min-h-0 flex-1 overflow-hidden", sideBySide ? "p-3" : "p-5")}>
          <PosTablePicker
            floors={floors ?? []}
            onSelect={handleTablePick}
            onQuickBill={() => setTableId(NO_TABLE)}
            isLoading={floorsQuery.isLoading || branchLoading}
            error={floorsQuery.isError ? floorsQuery.error : null}
            onRetry={() => void floorsQuery.refetch()}
            retrying={floorsQuery.isFetching}
          />
        </Card>
      ) : (
        <div
          className={cn(
            "grid min-h-0 flex-1 gap-6 overflow-hidden lg:grid-cols-[1fr_360px]",
            sideBySide ? "grid-cols-[minmax(0,1fr)_minmax(0,20rem)] gap-3" : "grid-cols-1",
          )}
        >
          <Card className={cn("min-h-0 overflow-hidden", sideBySide ? "p-3" : "p-3 sm:p-5")}>
            <ProductGrid branchId={branchId} onSelect={handleSelect} onAddOther={addOtherItem} />
          </Card>

          <Card
            className={cn(
              // A column: "Back to menu" on top, the cart below takes the rest,
              // so its Send to kitchen / Bill button never falls off screen.
              "flex min-h-0 flex-col overflow-hidden p-5",
              sideBySide
                ? "p-3"
                : cartOpen
                ? // Phones: full screen down to the bottom bar, which stays usable
                  // (Point of Sale there starts the next bill). Same z as the bar,
                  // which comes later in the page, so its raised button is on top;
                  // pb-7 keeps that button off the cart's last button.
                  "max-lg:fixed max-lg:inset-x-0 max-lg:top-0 max-lg:bottom-[calc(4rem+env(safe-area-inset-bottom))] max-lg:z-30 max-lg:rounded-none max-lg:p-4 max-lg:pt-[max(1rem,env(safe-area-inset-top))] max-lg:pb-7"
                : "max-lg:hidden",
            )}
          >
            <button
              type="button"
              onClick={() => setCartOpen(false)}
              className={cn(
                "mb-3 -ml-1 flex items-center gap-1 text-sm font-medium text-muted-foreground lg:hidden",
                sideBySide && "hidden",
              )}
            >
              <ChevronLeft className="h-4 w-4" />
              Back to menu
            </button>
            <div className="flex min-h-0 flex-1 flex-col">
            {activeOrder ? (
              <CheckoutPanel
                order={activeOrder}
                branchId={branchId}
                initialCustomer={activeCustomer}
                onDone={resetForNewOrder}
              />
            ) : (
              <CartPanel
                lines={lines}
                orderType={orderType}
                onOrderTypeChange={setOrderType}
                tables={tables}
                tableId={tableId}
                onTableChange={setTableId}
                onIncrement={(key) => updateQuantity(key, 1)}
                onDecrement={(key) => updateQuantity(key, -1)}
                onRemove={removeLine}
                onAddOther={addOtherItem}
                onSubmit={handleSubmit}
                isSubmitting={createOrder.isPending || addOrderItems.isPending}
                existingOrderNumber={existingOrder?.orderNumber}
                existingItems={existingOrderDetail?.items.map((i) => ({
                  id: i.id,
                  name: i.nameSnapshot,
                  quantity: i.quantity,
                  lineTotal: Number(i.lineTotal),
                }))}
                existingTotal={existingOrder ? Number(existingOrder.totalAmount) : undefined}
                onViewExistingOrder={existingOrder ? viewExistingOrder : undefined}
                openBills={existingOrders?.map((o) => ({ id: o.id, orderNumber: o.orderNumber }))}
                selectedBillId={existingOrder?.id ?? null}
                onSelectBill={setSelectedBillId}
                checkingTable={checkingTable}
                delivery={delivery}
                onDeliveryChange={setDelivery}
                scheduledFor={scheduledFor}
                onScheduledForChange={setScheduledFor}
              />
            )}
            </div>
          </Card>
        </div>
      )}

      {!showTablePicker && !cartOpen && !sideBySide && (lines.length > 0 || activeOrder || existingOrder) && (
        <button
          type="button"
          onClick={() => setCartOpen(true)}
          className="fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 flex h-14 items-center justify-between rounded-2xl bg-primary px-4 text-primary-foreground shadow-lg active:scale-[0.98] lg:hidden"
          style={{ backgroundImage: "var(--gradient-primary)" }}
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            <ShoppingCart className="h-5 w-5" />
            {activeOrder
              ? `Order #${activeOrder.orderNumber} — pay`
              : lines.length > 0
                ? `View cart · ${lines.reduce((n, l) => n + l.quantity, 0)} items`
                : `Open bill #${existingOrder?.orderNumber} — view`}
          </span>
          {!activeOrder && lines.length > 0 && (
            <span className="text-sm font-semibold tabular-nums">
              {formatCurrency(lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0))}
            </span>
          )}
        </button>
      )}

      <ModifierPickerDialog
        item={pickerItem}
        open={!!pickerItem}
        onOpenChange={(open) => !open && setPickerItem(null)}
        onConfirm={handleModifierConfirm}
        allowCustom
      />
    </div>
  );
}
