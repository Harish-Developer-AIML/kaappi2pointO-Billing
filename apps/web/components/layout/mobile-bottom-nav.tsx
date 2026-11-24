"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import type { SessionUser } from "@nodedr-restaurant/types";
import { hasPermission } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";
import { useNavBadges } from "@/hooks/use-nav-badges";
import { onPosLinkClick } from "@/lib/pos-events";
import { NAV_ITEMS, type NavItem } from "./nav-items";

// Phone bottom bar: two screens left, Point of Sale raised in the centre, one
// right, then More (the drawer with everything else). The side slots take the
// first screens from this list the signed-in role may open, so a waiter or
// kitchen login still gets a full bar.
const CENTER_HREF = "/pos";
const SIDE_HREFS = ["/dashboard", "/orders", "/menu", "/customers", "/tables", "/reports"];

// Thumb-reach navigation for phones. Hidden from lg up, where the sidebar takes over.
export function MobileBottomNav({
  user,
  onMore,
}: {
  user?: SessionUser;
  onMore: () => void;
}) {
  const pathname = usePathname();
  const { t } = useI18n();
  const badges = useNavBadges();

  const allowed = NAV_ITEMS.filter(
    (item) => !item.permission || hasPermission(user, item.permission),
  );
  const center = allowed.find((i) => i.href === CENTER_HREF);
  const sides = SIDE_HREFS.map((href) => allowed.find((i) => i.href === href))
    .filter((i): i is NavItem => !!i)
    .slice(0, center ? 3 : 4);
  const left = center ? sides.slice(0, 2) : sides;
  const right = center ? sides.slice(2) : [];

  const itemClass =
    "relative flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors";

  const sideLink = (item: NavItem) => {
    const isActive = pathname?.startsWith(item.href);
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={isActive ? "page" : undefined}
        className={cn(
          itemClass,
          "h-16",
          isActive ? "font-semibold text-primary" : "text-muted-foreground active:text-foreground",
        )}
      >
        <Icon className="h-5 w-5" strokeWidth={isActive ? 2.5 : 2} />
        <span className="max-w-full truncate px-1">{t(item.labelKey)}</span>
        {badges.nav[item.href] && !isActive ? (
          <span className="absolute top-2 left-1/2 ml-2 h-2.5 w-2.5 rounded-full bg-amber-500 shadow-[0_0_8px_2px_rgba(245,158,11,0.7)]" />
        ) : null}
      </Link>
    );
  };

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      {left.map(sideLink)}
      {center && (
        <Link
          href={center.href}
          onClick={() => onPosLinkClick(pathname)}
          aria-current={pathname?.startsWith(center.href) ? "page" : undefined}
          className={cn(itemClass, "h-16 justify-end pb-1.5")}
        >
          {/* Raised round button: the one action used all shift. */}
          <span
            className={cn(
              "absolute -top-5 flex h-14 w-14 items-center justify-center rounded-full text-primary-foreground shadow-lg ring-4 ring-background",
              pathname?.startsWith(center.href) ? "brightness-110" : "",
            )}
            style={{ backgroundImage: "var(--gradient-primary)" }}
          >
            <center.icon className="h-6 w-6" strokeWidth={2.4} />
          </span>
          <span
            className={cn(
              "max-w-full truncate px-1",
              pathname?.startsWith(center.href) ? "font-semibold text-primary" : "text-foreground",
            )}
          >
            {t(center.labelKey)}
          </span>
        </Link>
      )}
      {right.map(sideLink)}
      <button
        type="button"
        onClick={onMore}
        className={cn(itemClass, "h-16 text-muted-foreground active:text-foreground")}
      >
        <MoreHorizontal className="h-5 w-5" />
        <span>More</span>
      </button>
    </nav>
  );
}
