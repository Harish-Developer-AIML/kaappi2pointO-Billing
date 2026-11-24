/** App version from the repo-root VERSION file (next.config.ts). */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";

export function BrandFooter() {
  return (
    <div className="flex flex-col gap-2 border-t border-sidebar-border px-4 py-3">
      <span className="flex items-baseline justify-between gap-2 text-left text-xs font-medium leading-tight text-sidebar-foreground/70">
        Kaappi Biller
        <span className="font-mono text-[11px] text-sidebar-foreground/50">v{APP_VERSION}</span>
      </span>
    </div>
  );
}
