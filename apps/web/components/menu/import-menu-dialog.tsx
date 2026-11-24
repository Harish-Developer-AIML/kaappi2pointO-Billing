"use client";

import {
  MENU_IMPORT_SAMPLE,
  menuImportSchema,
  type MenuImport,
  type MenuImportResult,
} from "@nodedr-restaurant/types";
import { ArrowRight, Copy, Download, FileJson, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useImportMenu } from "@/hooks/use-menu";
import { ApiError } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

const SAMPLE_TEXT = JSON.stringify(MENU_IMPORT_SAMPLE, null, 2);

/** Readable place for a schema problem: `Category 2 “Snacks” › item 3 “Veg Puff” › price`. */
function describePath(path: PropertyKey[], raw: unknown): string {
  const parts: string[] = [];
  let node: unknown = raw;
  for (let i = 0; i < path.length; i++) {
    const key = path[i];
    const next = (node as Record<PropertyKey, unknown> | undefined)?.[key as never];
    if (key === "menu" || key === "items") {
      node = next;
      continue;
    }
    if (typeof key === "number") {
      const parent = path[i - 1];
      const entry = next as { category?: unknown; name?: unknown } | undefined;
      const label = parent === "menu" ? "Category" : "item";
      const name = parent === "menu" ? entry?.category : entry?.name;
      parts.push(`${label} ${key + 1}${typeof name === "string" && name.trim() ? ` “${name.trim()}”` : ""}`);
    } else {
      parts.push(String(key));
    }
    node = next;
  }
  return parts.join(" › ") || "The file";
}

type Step =
  | { kind: "choose"; error?: string[] }
  | { kind: "preview"; file: MenuImport; fileName: string; preview: MenuImportResult };

/**
 * Menu › Upload JSON: pick (or paste) a menu file, see exactly what it will
 * add and change, then import. Matching dishes get the file's price; nothing
 * is deleted. Format and sample: packages/types/src/menu-import.ts.
 */
export function ImportMenuDialog({ branchId }: { branchId: string | null }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>({ kind: "choose" });
  const [pasted, setPasted] = useState("");
  const [showSample, setShowSample] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const importMenu = useImportMenu(branchId);

  const reset = () => {
    setStep({ kind: "choose" });
    setPasted("");
    setShowSample(false);
    if (fileInput.current) fileInput.current.value = "";
  };

  const check = (text: string, fileName: string) => {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (err) {
      setStep({ kind: "choose", error: [`This is not valid JSON: ${(err as Error).message}`] });
      return;
    }
    // A bare list of categories is accepted too.
    if (Array.isArray(raw)) raw = { menu: raw };
    const parsed = menuImportSchema.safeParse(raw);
    if (!parsed.success) {
      const problems = parsed.error.issues.slice(0, 6).map((i) => `${describePath(i.path, raw)}: ${i.message}`);
      const more = parsed.error.issues.length - problems.length;
      setStep({ kind: "choose", error: more > 0 ? [...problems, `…and ${more} more`] : problems });
      return;
    }
    importMenu.mutate(
      { file: parsed.data, dryRun: true },
      {
        onSuccess: (preview) => setStep({ kind: "preview", file: parsed.data, fileName, preview }),
        onError: (err) =>
          setStep({ kind: "choose", error: [err instanceof ApiError ? err.message : "Could not check the file"] }),
      },
    );
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 1_000_000) {
      setStep({ kind: "choose", error: ["The file is over 1 MB. A menu file is usually a few KB."] });
      return;
    }
    check(await file.text(), file.name);
  };

  const apply = () => {
    if (step.kind !== "preview") return;
    importMenu.mutate(
      { file: step.file, dryRun: false },
      {
        onSuccess: (r) => {
          toast.success(
            `Menu updated: ${r.itemsCreated.length} new, ${r.itemsUpdated.length} price change${r.itemsUpdated.length === 1 ? "" : "s"}`,
          );
          setOpen(false);
          reset();
        },
        onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not import the menu"),
      },
    );
  };

  const copySample = async () => {
    try {
      await navigator.clipboard.writeText(SAMPLE_TEXT);
      toast.success("Sample copied");
    } catch {
      toast.error("Could not copy. Select the text and copy it instead.");
    }
  };

  const preview = step.kind === "preview" ? step.preview : null;
  const changes = preview
    ? preview.categoriesCreated.length + preview.itemsCreated.length + preview.itemsUpdated.length
    : 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <Upload className="h-4 w-4" />
            Upload JSON
          </Button>
        }
      />
      <DialogContent className="grid-cols-[minmax(0,1fr)] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload menu (JSON)</DialogTitle>
        </DialogHeader>

        {step.kind === "choose" ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              New categories and dishes are added. A dish with the same name in the same category gets the price from
              the file. Nothing is deleted. You see every change before it is made.
            </p>

            <input
              ref={fileInput}
              type="file"
              accept=".json,application/json,text/plain"
              className="hidden"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
            <Button
              type="button"
              className="h-12 font-semibold"
              disabled={importMenu.isPending}
              onClick={() => fileInput.current?.click()}
            >
              <FileJson className="h-5 w-5" />
              {importMenu.isPending ? "Checking…" : "Choose JSON file"}
            </Button>

            <details className="rounded-lg border border-border px-3 py-2">
              <summary className="cursor-pointer text-sm font-medium">Or paste the JSON</summary>
              <div className="flex flex-col gap-2 pt-2">
                <Textarea
                  rows={6}
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value)}
                  placeholder='{ "menu": [ { "category": "Hot Drinks", "items": [ { "name": "Tea", "price": 20 } ] } ] }'
                  className="font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={!pasted.trim() || importMenu.isPending}
                  onClick={() => check(pasted, "pasted JSON")}
                >
                  Check pasted JSON
                </Button>
              </div>
            </details>

            {step.error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                <p className="font-semibold">The file can’t be used yet:</p>
                <ul className="mt-1 list-disc pl-5">
                  {step.error.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-col gap-2 rounded-lg bg-secondary/50 p-3">
              <p className="text-sm font-medium">Sample file</p>
              <p className="text-xs text-muted-foreground">
                Each category has a name and dishes with a name and price. Optional: <code>description</code>,{" "}
                <code>veg</code> (true/false; guessed from the name when left out), <code>taxRatePercent</code>,{" "}
                <code>halfPrice</code>, and a category <code>serving</code> note like “5 pcs / plate”.
              </p>
              <div className="flex flex-wrap gap-2">
                <a
                  href={`/api/v1/menu/import/sample?branchId=${branchId ?? ""}`}
                  download="menu-sample.json"
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-secondary"
                >
                  <Download className="h-4 w-4" />
                  Download sample
                </a>
                <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => setShowSample((s) => !s)}>
                  {showSample ? "Hide sample" : "Show sample"}
                </Button>
                {showSample && (
                  <Button type="button" variant="outline" size="sm" className="h-9" onClick={copySample}>
                    <Copy className="h-4 w-4" />
                    Copy
                  </Button>
                )}
              </div>
              {showSample && (
                <pre className="max-h-56 overflow-auto rounded-md bg-background p-2 text-[11px] leading-snug">
                  {SAMPLE_TEXT}
                </pre>
              )}
            </div>
          </div>
        ) : (
          preview && (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{step.fileName}</span>: nothing has changed yet.
              </p>
              <div className="grid grid-cols-3 gap-2 text-center">
                <Stat label="New categories" value={preview.categoriesCreated.length} />
                <Stat label="New dishes" value={preview.itemsCreated.length} />
                <Stat label="Price changes" value={preview.itemsUpdated.length} />
              </div>
              {preview.itemsUnchanged > 0 && (
                <p className="text-xs text-muted-foreground">
                  {preview.itemsUnchanged} dish{preview.itemsUnchanged === 1 ? " is" : "es are"} already the same.
                </p>
              )}

              {preview.categoriesCreated.length > 0 && (
                <Section title="New categories">
                  <p className="text-sm">{preview.categoriesCreated.join(", ")}</p>
                </Section>
              )}
              {preview.itemsUpdated.length > 0 && (
                <Section title="Price changes">
                  {preview.itemsUpdated.map((i) => (
                    <Row key={`${i.category}/${i.name}`} name={i.name} category={i.category}>
                      <span className="text-muted-foreground line-through">{formatCurrency(i.priceBefore)}</span>
                      <ArrowRight className="h-3 w-3" />
                      <span className="font-semibold">{formatCurrency(i.price)}</span>
                    </Row>
                  ))}
                </Section>
              )}
              {preview.itemsCreated.length > 0 && (
                <Section title="New dishes">
                  {preview.itemsCreated.map((i) => (
                    <Row key={`${i.category}/${i.name}`} name={i.name} category={i.category} veg={i.isVeg}>
                      <span className="font-semibold">{formatCurrency(i.price)}</span>
                    </Row>
                  ))}
                </Section>
              )}
            </div>
          )
        )}

        {step.kind === "preview" && (
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={reset} disabled={importMenu.isPending}>
              Choose another file
            </Button>
            <Button type="button" className="font-semibold" onClick={apply} disabled={changes === 0 || importMenu.isPending}>
              {importMenu.isPending
                ? "Importing…"
                : changes === 0
                  ? "Nothing to change"
                  : `Import ${changes} change${changes === 1 ? "" : "s"}`}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border px-2 py-2">
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <div className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-lg border border-border p-2">{children}</div>
    </div>
  );
}

function Row({
  name,
  category,
  veg,
  children,
}: {
  name: string;
  category: string;
  veg?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="flex min-w-0 items-center gap-2">
        {veg !== undefined && (
          <span
            title={veg ? "Veg" : "Non-veg"}
            className={cn("h-2.5 w-2.5 shrink-0 rounded-full", veg ? "bg-green-600" : "bg-red-600")}
          />
        )}
        <span className="truncate">
          {name} <span className="text-xs text-muted-foreground">· {category}</span>
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1 tabular-nums">{children}</span>
    </div>
  );
}
