"use client";

import {
  DEFAULT_BILL_SETTINGS,
  resolveBillSettings,
  type BillLogo,
  type BillSettings,
  type TaxRegime,
} from "@nodedr-restaurant/types";
import { ImageIcon, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { BranchNotice } from "@/components/layout/branch-notice";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useBranch } from "@/hooks/use-branch";
import { useBillPreview, useSettings, useUpdateBranchSettings, type BranchSettings } from "@/hooks/use-settings";
import { ApiError } from "@/lib/api";
import { makeBillLogo, rasterPreview } from "@/lib/bill-logo";
import { cn } from "@/lib/utils";

// Settings › Bill: every part of the printed bill, with a live sample bill.
// The same choices apply to browser/PDF bills and thermal (USB, network,
// Bluetooth) bills.
export default function BillSettingsPage() {
  const { branchId } = useBranch();
  const { data, isLoading } = useSettings(branchId);

  return (
    <div className="flex flex-col gap-6">
      <SettingsTabs />
      {!branchId ? (
        <BranchNotice />
      ) : isLoading || !data ? (
        <Skeleton className="h-96 rounded-2xl" />
      ) : (
        <BillSettingsForm key={data.branch.id} branchId={branchId} branch={data.branch} />
      )}
    </div>
  );
}

type TaxChoice = "GST" | "CUSTOM" | "NONE";

function BillSettingsForm({ branchId, branch }: { branchId: string; branch: BranchSettings }) {
  const update = useUpdateBranchSettings(branchId);
  const preview = useBillPreview(branchId);
  const [bill, setBill] = useState<BillSettings>(() => resolveBillSettings(branch.billSettings));
  const [address, setAddress] = useState(branch.address ?? "");
  const [phone, setPhone] = useState(branch.phone ?? "");
  const [gstNumber, setGstNumber] = useState(branch.gstNumber ?? "");
  const [taxChoice, setTaxChoice] = useState<TaxChoice>(() =>
    !resolveBillSettings(branch.billSettings).showTaxBreakup
      ? "NONE"
      : branch.taxRegime === "INDIA_GST"
        ? "GST"
        : "CUSTOM",
  );
  const [customTaxName, setCustomTaxName] = useState(branch.taxLabel ?? "");
  const [previewHtml, setPreviewHtml] = useState("");

  const set = <K extends keyof BillSettings>(key: K, value: BillSettings[K]) =>
    setBill((b) => ({ ...b, [key]: value }));

  // What the tax choice means for the branch row and the bill switches.
  const taxRegime: TaxRegime = taxChoice === "GST" ? "INDIA_GST" : branch.taxRegime === "INDIA_GST" ? "CUSTOM" : branch.taxRegime;
  const taxLabel = taxChoice === "CUSTOM" ? customTaxName.trim() || null : null;
  const effectiveBill: BillSettings = { ...bill, showTaxBreakup: taxChoice !== "NONE" };

  // Live preview, refreshed shortly after each change.
  const previewRequest = JSON.stringify({
    bill: effectiveBill,
    branch: {
      address: address.trim() || null,
      phone: phone.trim() || null,
      gstNumber: gstNumber.trim() || null,
      taxLabel,
      ...(taxChoice === "NONE" ? {} : { taxRegime }),
    },
  });
  const runPreview = preview.mutate; // stable (TanStack Query)
  useEffect(() => {
    const t = setTimeout(() => {
      runPreview(JSON.parse(previewRequest), { onSuccess: setPreviewHtml });
    }, 350);
    return () => clearTimeout(t);
  }, [previewRequest, runPreview]);

  const save = () =>
    update.mutate(
      {
        billSettings: effectiveBill,
        address: address.trim(),
        phone: phone.trim(),
        gstNumber: gstNumber.trim(),
        ...(taxChoice === "NONE" ? {} : { taxRegime, taxLabel }),
      },
      {
        onSuccess: () => toast.success("Bill settings saved"),
        onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not save bill settings"),
      },
    );

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px] lg:items-start">
      <div className="flex flex-col gap-6">
        <Section title="Logos" hint="Optional: one on the left, one on the right, or both. Printed at the top of the bill.">
          <div className="grid grid-cols-2 gap-3">
            <LogoPicker label="Left logo" logo={bill.logoLeft} onChange={(l) => set("logoLeft", l)} />
            <LogoPicker label="Right logo" logo={bill.logoRight} onChange={(l) => set("logoRight", l)} />
          </div>
          {(bill.logoLeft || bill.logoRight) && (
            <>
              <Field label={`Logo size: ${bill.logoSizeMm} mm`} hint="Height on the bill. Bigger logos leave less room for the shop name between them.">
                <input
                  type="range"
                  min={10}
                  max={30}
                  step={1}
                  value={bill.logoSizeMm}
                  onChange={(e) => set("logoSizeMm", Number(e.target.value))}
                  aria-label="Logo size in millimetres"
                  className="h-10 w-full accent-[var(--primary)]"
                />
              </Field>
              <Field label="Logo position" hint="Level with the top, middle or bottom of the shop details.">
                <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Logo position">
                  {(["top", "middle", "bottom"] as const).map((a) => (
                    <Choice
                      key={a}
                      active={bill.logoAlign === a}
                      onClick={() => set("logoAlign", a)}
                      title={a === "top" ? "Top" : a === "middle" ? "Middle" : "Bottom"}
                      text={a === "top" ? "Move up" : a === "middle" ? "Centred" : "Move down"}
                    />
                  ))}
                </div>
              </Field>
            </>
          )}
        </Section>

        <Section title="Shop details on the bill" hint="Printed at the top of every bill.">
          <Toggle label="Restaurant name" checked={bill.showRestaurantName} onChange={(v) => set("showRestaurantName", v)} />
          <Toggle label="Branch name" checked={bill.showBranchName} onChange={(v) => set("showBranchName", v)} />
          <ToggleWithField
            label="Address"
            checked={bill.showAddress}
            onChange={(v) => set("showAddress", v)}
          >
            <Textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Shop no., street, area, city, PIN" />
          </ToggleWithField>
          <ToggleWithField label="Phone number" checked={bill.showPhone} onChange={(v) => set("showPhone", v)}>
            <Input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="e.g. 98765 43210" />
          </ToggleWithField>
          <ToggleWithField label="GSTIN" checked={bill.showTaxId} onChange={(v) => set("showTaxId", v)}>
            <Input value={gstNumber} onChange={(e) => setGstNumber(e.target.value.toUpperCase())} placeholder="e.g. 33ABCDE1234F1Z5" />
          </ToggleWithField>
          <Field label="Extra line under the header" hint="Optional, e.g. “Pure veg · Since 1990”">
            <Input value={bill.headerNote} maxLength={120} onChange={(e) => set("headerNote", e.target.value)} />
          </Field>
          <Field label="Bill title" hint="Optional, e.g. “TAX INVOICE”">
            <Input value={bill.billTitle} maxLength={40} onChange={(e) => set("billTitle", e.target.value)} />
          </Field>
        </Section>

        <Section title="Order details" hint="The line under the header. The table number is printed on the right.">
          <Toggle label="Order type (Dine in / Takeaway)" checked={bill.showOrderType} onChange={(v) => set("showOrderType", v)} />
          <Toggle label="Table number" checked={bill.showTable} onChange={(v) => set("showTable", v)} />
          <Toggle label="Customer name" checked={bill.showCustomer} onChange={(v) => set("showCustomer", v)} />
        </Section>

        <Section title="GST on the bill" hint="Prices don’t change; this only decides what the bill shows.">
          <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Tax on the bill">
            <Choice
              active={taxChoice === "GST"}
              onClick={() => setTaxChoice("GST")}
              title="GST"
              text="“GST @ 5%” per item and CGST + SGST totals"
            />
            <Choice
              active={taxChoice === "CUSTOM"}
              onClick={() => setTaxChoice("CUSTOM")}
              title="Other tax name"
              text="Your own word for tax"
            />
            <Choice
              active={taxChoice === "NONE"}
              onClick={() => setTaxChoice("NONE")}
              title="Without GST"
              text="No tax lines on the bill"
            />
          </div>
          {taxChoice === "CUSTOM" && (
            <Field label="Tax name on the bill">
              <Input value={customTaxName} maxLength={30} onChange={(e) => setCustomTaxName(e.target.value)} placeholder="e.g. Tax, VAT" />
            </Field>
          )}
          {taxChoice !== "NONE" && (
            <Toggle label="Show the tax rate under each item" checked={bill.showItemTax} onChange={(v) => set("showItemTax", v)} />
          )}
        </Section>

        <Section title="Totals" hint="One TOTAL line is always printed.">
          <Toggle label="Subtotal (only when it differs from the total, e.g. after a discount)" checked={bill.showSubtotal} onChange={(v) => set("showSubtotal", v)} />
          <Toggle label="Payment (Paid cash / card, change)" checked={bill.showPayments} onChange={(v) => set("showPayments", v)} />
        </Section>

        <Section title="Footer" hint="Printed at the bottom of a paid bill.">
          <Field label="Footer text">
            <Input value={bill.footerText} maxLength={160} onChange={(e) => set("footerText", e.target.value)} />
          </Field>
        </Section>

        <div className="flex flex-wrap gap-3">
          <Button className="h-11 min-w-40 font-semibold" onClick={save} disabled={update.isPending}>
            {update.isPending ? "Saving…" : "Save bill settings"}
          </Button>
          <Button
            variant="outline"
            className="h-11"
            onClick={() => {
              setBill(DEFAULT_BILL_SETTINGS);
              setTaxChoice(branch.taxRegime === "INDIA_GST" ? "GST" : "CUSTOM");
            }}
          >
            Reset to standard bill
          </Button>
        </div>
      </div>

      <Card className="flex flex-col gap-3 p-4 lg:sticky lg:top-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Preview</h2>
          <span className="text-xs text-muted-foreground">Sample bill · updates as you edit</span>
        </div>
        <div className="overflow-hidden rounded-lg border border-border bg-white">
          {previewHtml ? (
            <iframe title="Bill preview" srcDoc={previewHtml} sandbox="" className="h-[560px] w-full" />
          ) : (
            <Skeleton className="h-[560px] rounded-none" />
          )}
        </div>
      </Card>
    </div>
  );
}

function LogoPicker({
  label,
  logo,
  onChange,
}: {
  label: string;
  logo: BillLogo | null;
  onChange: (logo: BillLogo | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  // How it comes out on a thermal printer (black and white dots).
  const printed = useMemo(
    () => (logo && typeof document !== "undefined" ? rasterPreview(logo.raster) : null),
    [logo],
  );

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      onChange(await makeBillLogo(file));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not use this image");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-xl border border-border p-3">
      <span className="text-sm font-semibold text-foreground">{label}</span>
      <div className="flex h-20 items-center justify-center rounded-lg bg-secondary/40">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element -- a data URL, nothing to optimise
          <img src={logo.image} alt={label} className="max-h-16 max-w-full object-contain" />
        ) : (
          <span className="flex flex-col items-center gap-1 text-xs text-muted-foreground">
            <ImageIcon className="h-5 w-5" />
            No logo
          </span>
        )}
      </div>
      {printed && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          {/* eslint-disable-next-line @next/next/no-img-element -- generated preview */}
          <img src={printed} alt="" className="h-8 max-w-[50%] border border-border object-contain [image-rendering:pixelated]" />
          On thermal paper
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => choose(e.target.files?.[0])}
      />
      <div className="flex items-center gap-1">
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? "Preparing…" : logo ? "Change" : "Choose image"}
        </Button>
        {logo && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={`Remove ${label.toLowerCase()}`}
            onClick={() => onChange(null)}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        )}
      </div>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <Card className="flex flex-col gap-4 p-5 sm:p-6">
      <div>
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </Card>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4 text-[15px] font-medium text-foreground">
      {label}
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

function ToggleWithField({
  label,
  checked,
  onChange,
  children,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Toggle label={label} checked={checked} onChange={onChange} />
      <div className={cn(!checked && "opacity-60")}>{children}</div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Choice({ active, onClick, title, text }: { active: boolean; onClick: () => void; title: string; text: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "flex flex-col items-start gap-1 rounded-xl border-2 p-3 text-left transition-colors",
        active ? "border-primary bg-primary/5" : "border-border hover:border-primary/40",
      )}
    >
      <span className="text-sm font-semibold text-foreground">{title}</span>
      <span className="text-xs text-muted-foreground">{text}</span>
    </button>
  );
}
