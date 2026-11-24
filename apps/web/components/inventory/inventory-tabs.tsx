"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ResponsiveTabs } from "@/components/ui/nav-picker";
import { cn } from "@/lib/utils";

const TABS = [
  { label: "Ingredients", href: "/inventory" },
  { label: "Suppliers", href: "/inventory/suppliers" },
  { label: "Purchase Orders", href: "/inventory/purchase-orders" },
  { label: "Procurement", href: "/inventory/procurement" },
  { label: "Transfers", href: "/inventory/transfers" },
  { label: "Waste", href: "/inventory/waste" },
];

export function InventoryTabs() {
  const pathname = usePathname();
  const router = useRouter();
  const active =
    TABS.find((t) => (t.href === "/inventory" ? pathname === "/inventory" : pathname?.startsWith(t.href))) ?? TABS[0];

  return (
    <>
      {/* Phones: one "Section" button with a list (six tabs don't fit a row
          and used to widen the whole page sideways). */}
      <ResponsiveTabs
        mobileOnly
        label="Section"
        items={TABS.map((t) => ({ id: t.href, label: t.label }))}
        value={active.href}
        onChange={(href) => router.push(href)}
      />
      <nav className="hidden min-w-0 gap-1 overflow-x-auto border-b border-border lg:flex">
      {TABS.map((tab) => {
        const isActive =
          tab.href === "/inventory" ? pathname === "/inventory" : pathname?.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "shrink-0 whitespace-nowrap border-b-2 px-3 pb-3 text-sm font-medium transition-colors",
              isActive
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
      </nav>
    </>
  );
}
