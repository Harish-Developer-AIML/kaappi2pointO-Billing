"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ResponsiveTabs } from "@/components/ui/nav-picker";
import { hasPermission, useCurrentUser } from "@/hooks/use-auth";
import { useNavBadges } from "@/hooks/use-nav-badges";
import { useBranch } from "@/hooks/use-branch";
import { useSettings } from "@/hooks/use-settings";
import { cn } from "@/lib/utils";
import { NavDot } from "@/components/layout/nav-dot";

interface SettingsTab {
  label: string;
  href: string;
  /** Omit to show the tab to anyone who can reach /settings at all. */
  permission?: string;
  /** Only shown for branches in this country (ISO code). */
  country?: string;
}

const TABS: SettingsTab[] = [
  { label: "General", href: "/settings" },
  { label: "Bill", href: "/settings/bill", permission: "settings.manage" },
  { label: "Staff", href: "/settings/staff", permission: "users.manage" },
  { label: "Roles", href: "/settings/roles", permission: "roles.manage" },
  { label: "Audit Log", href: "/settings/audit-log", permission: "audit_log.view" },
  { label: "Backup", href: "/settings/backup", permission: "backup.manage" },
  { label: "Updates", href: "/settings/updates", permission: "system.update" },
  { label: "Server Sync", href: "/settings/sync", permission: "settings.manage" },
  { label: "API Keys", href: "/settings/api-keys" },
  { label: "Security", href: "/settings/security" },
  { label: "Webhooks", href: "/settings/webhooks", permission: "settings.manage" },
  { label: "VERI*FACTU", href: "/settings/verifactu", permission: "settings.manage", country: "ES" },
];

export function SettingsTabs() {
  const pathname = usePathname();
  const { data } = useCurrentUser();
  const user = data?.user;
  const badges = useNavBadges();
  const { branchId } = useBranch();
  const branchCountry = useSettings(branchId).data?.branch.country;

  const visibleTabs = TABS.filter(
    (tab) =>
      (!tab.permission || hasPermission(user, tab.permission)) &&
      (!tab.country || branchCountry === tab.country),
  );

  const router = useRouter();
  const isActive = (href: string) =>
    href === "/settings" ? pathname === "/settings" : !!pathname?.startsWith(href);
  const active = visibleTabs.find((t) => isActive(t.href)) ?? visibleTabs[0];

  return (
    <>
    {/* Phones: one "Section" button with a list instead of a row of 11 tabs
        cut off at the screen edge. */}
    {active && (
      <ResponsiveTabs
        mobileOnly
        label="Settings section"
        items={visibleTabs.map((t) => ({
          id: t.href,
          label: t.label,
          hint: badges.settingsTabs[t.href] ? "•" : undefined,
        }))}
        value={active.href}
        onChange={(href) => router.push(href)}
      />
    )}
    <nav className="-mx-1 hidden min-w-0 gap-1 overflow-x-auto border-b border-border px-1 [scrollbar-width:none] lg:flex [&::-webkit-scrollbar]:hidden">
      {/* Scrolls sideways on its own on narrow screens; without overflow-x-auto
          the row of 10+ tabs widened the whole page and cut off the form. */}
      {visibleTabs.map((tab) => {
        const tabActive = isActive(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 pb-3 text-sm font-medium transition-colors",
              tabActive
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
            {badges.settingsTabs[tab.href] ? <NavDot className="ml-0" /> : null}
          </Link>
        );
      })}
    </nav>
    </>
  );
}
