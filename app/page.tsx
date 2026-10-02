"use client";

import { useMemo, useState } from "react";
import type { ParsedBomLine } from "@/lib/bom-parser";
import { defaultCandidateIndex, type RankedCandidate } from "@/lib/match-ranker";
import { formatRequirement } from "@/lib/package";
import { buildPasteListsBySupplier, type CartSelection } from "@/lib/cart-builder";
import { DIGIKEY_SITES, type DigiKeySite } from "@/lib/digikey-client";

interface MatchResult {
  line: ParsedBomLine;
  keyword: string;
  candidates: RankedCandidate[];
  error?: string;
}

const SUPPLIER_LABEL: Record<CartSelection["supplier"], string> = {
  mouser: "Mouser",
  digikey: "DigiKey",
};

const SUPPLIER_BOM_TOOL_URL: Record<CartSelection["supplier"], string> = {
  mouser: "https://www.mouser.com/en/Bom/",
  digikey: "https://www.digikey.com/en/mylists",
};

// Real fixture, from github.com/TOILmodular/TuringMachine (a fork of Music
// Thing Modular's well-known open-source Turing Machine module) — the exact
// format this parser targets, table and all.
const SAMPLE_BOM = `| Description | Value | Quantity | |
| --- | --- | --- | --- |
| Resistor 1/4W | 100K | 15 | |
| Capacitor Electrolytic | 10uF | 2 | |
| Diode | 1N4148 | 1 | |
| LED | 3mm | 10 | |
| Op Amp | TL074 or UPC824 | 1 | SMD |
| Toggle Switch | (ON)-OFF-(ON) | 1 | SPDT, Momentary Spring Return Switch |
| Potentiometer | B50K | 2 | |
| Mono Jack | 3.5mm | 5 | |
| Header | 2.54mm Male 1x5 | 2 | Connector Main Board |`;

const SKIP = "__skip__";
// Shown as the selection when no candidate was picked by default because
// every top candidate is a confirmed package mismatch.
const NONE = "__none__";

// Kinds where the same part number commonly comes in several packages, so
// a BOM line that doesn't name one is worth pointing out.
const PACKAGE_SENSITIVE_KINDS = new Set(["ic", "transistor", "diode", "other"]);

// The dropdown value for line i: the user's choice if they made one,
// otherwise the default pick (or NONE when there is no safe default).
function selectionFor(selections: Record<number, string>, r: MatchResult, i: number): string {
  const explicit = selections[i];
  if (explicit !== undefined) return explicit;
  const d = defaultCandidateIndex(r.candidates);
  return d === null ? NONE : String(d);
}

function chosenCandidate(
  selections: Record<number, string>,
  r: MatchResult,
  i: number,
): RankedCandidate | undefined {
  const sel = selectionFor(selections, r, i);
  if (sel === SKIP || sel === NONE) return undefined;
  return r.candidates[parseInt(sel, 10)];
}

function packageLabel(c: RankedCandidate): string {
  const found = c.pkg.found ?? "?";
  switch (c.pkg.status) {
    case "match":
      return `pkg ✓ ${found}`;
    case "mismatch":
      return `pkg ✗ ${found}`;
    case "unknown":
      return `pkg ? ${c.pkg.found ?? ""}`.trim();
    default:
      return c.pkg.found ? `pkg ${c.pkg.found}` : "pkg ?";
  }
}

export default function Home() {
  const [bomText, setBomText] = useState(SAMPLE_BOM);
  const [digikeySite, setDigikeySite] = useState<DigiKeySite>("JP");
  const [results, setResults] = useState<MatchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [selections, setSelections] = useState<Record<number, string>>({});
  const [copied, setCopied] = useState<CartSelection["supplier"] | null>(null);

  async function handleMatch() {
    setLoading(true);
    setCopied(null);
    try {
      const res = await fetch("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bomText, digikeySite }),
      });
      const data = await res.json();
      setResults(data.results);
      setSelections({});
    } finally {
      setLoading(false);
    }
  }

  const pasteListsBySupplier = useMemo(() => {
    if (!results) return {};
    const chosen = results.map((r, i) => {
      const candidate = chosenCandidate(selections, r, i);
      if (!candidate) return null;
      const selection: CartSelection = {
        supplier: candidate.part.supplier,
        supplierPartNumber: candidate.part.supplierPartNumber,
        quantity: r.line.quantity,
        note: [r.line.description, r.line.value, r.line.note]
          .filter(Boolean)
          .join(" "),
      };
      return selection;
    });
    return buildPasteListsBySupplier(chosen.filter((c) => c !== null));
  }, [results, selections]);

  // Mouser is always priced in JPY (its account-locked currency); DigiKey's
  // currency now follows the chosen country. Summing raw numbers across two
  // different currencies would silently produce a meaningless total, so
  // track which currency symbol each chosen line actually used and only
  // show one combined total when they all agree.
  const totalCost = useMemo(() => {
    if (!results) return null;
    let total = 0;
    let anyPriced = false;
    const currencySymbols = new Set<string>();
    results.forEach((r, i) => {
      const candidate = chosenCandidate(selections, r, i);
      if (!candidate) return;
      const symbol = candidate.part.price.replace(/[\d.,\s]/g, "");
      const price = parseFloat(candidate.part.price.replace(/[^\d.]/g, ""));
      if (Number.isFinite(price)) {
        total += price * r.line.quantity;
        anyPriced = true;
        if (symbol) currencySymbols.add(symbol);
      }
    });
    if (!anyPriced) return null;
    if (currencySymbols.size > 1) return { mixed: true as const };
    return { mixed: false as const, symbol: [...currencySymbols][0] ?? "", total };
  }, [results, selections]);

  // Counts for the package summary above the results table.
  const packageSummary = useMemo(() => {
    if (!results) return null;
    let mismatched = 0;
    let unconfirmed = 0;
    let leftOut = 0;
    let unspecified = 0;
    results.forEach((r, i) => {
      if (r.candidates.length === 0) return;
      const sel = selectionFor(selections, r, i);
      if (sel === SKIP) return;
      if (sel === NONE) {
        leftOut++;
        return;
      }
      const c = r.candidates[parseInt(sel, 10)];
      if (!c) return;
      if (c.pkg.status === "mismatch") mismatched++;
      else if (c.pkg.status === "unknown") unconfirmed++;
      else if (c.pkg.status === "unspecified" && PACKAGE_SENSITIVE_KINDS.has(r.line.kind)) unspecified++;
    });
    return { mismatched, unconfirmed, leftOut, unspecified };
  }, [results, selections]);

  async function handleCopy(supplier: CartSelection["supplier"]) {
    await navigator.clipboard.writeText(pasteListsBySupplier[supplier] ?? "");
    setCopied(supplier);
  }

  return (
    <div className="min-h-screen bg-zinc-50 px-6 py-12 font-sans dark:bg-black">
      <main className="mx-auto flex max-w-3xl flex-col gap-8">
        <div>
          <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
            Eurorack BOM
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Paste an open-source Eurorack module&apos;s parts table, get
            matched supplier parts compared across Mouser and DigiKey,
            cheapest wins automatically. Built for the Music Thing
            Modular / Befaco style{" "}
            <code className="rounded bg-zinc-200 px-1 dark:bg-zinc-800">
              | Description | Value | Quantity | Note |
            </code>{" "}
            table format.
          </p>
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-500">
            Honest limitation: switches, jacks, and headers don&apos;t have a
            searchable part number the way resistors/caps/ICs do, so those
            matches are always marked{" "}
            <span className="font-mono">[unknown]</span> confidence — check
            them by hand before ordering.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <textarea
            className="h-56 w-full rounded-lg border border-zinc-300 bg-white p-3 font-mono text-sm text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            value={bomText}
            onChange={(e) => setBomText(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-zinc-600 dark:text-zinc-400">
              DigiKey country:
            </label>
            <select
              className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
              value={digikeySite}
              onChange={(e) => setDigikeySite(e.target.value as DigiKeySite)}
            >
              {DIGIKEY_SITES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.label}
                </option>
              ))}
            </select>
            <span className="text-xs text-zinc-500 dark:text-zinc-500">
              Mouser results always reflect this tool&apos;s own account
              country (Japan) — Mouser&apos;s search API has no per-request
              country/currency option.
            </span>
          </div>
          <button
            onClick={handleMatch}
            disabled={loading}
            className="w-fit rounded-full bg-black px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
          >
            {loading ? "Matching..." : "Match parts"}
          </button>
        </div>

        {results && (
          <>
            {packageSummary &&
              packageSummary.mismatched + packageSummary.unconfirmed + packageSummary.leftOut + packageSummary.unspecified > 0 && (
                <div className="flex flex-col gap-1 rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-600 dark:bg-amber-950 dark:text-amber-200">
                  <p className="font-semibold">Package check</p>
                  {packageSummary.leftOut > 0 && (
                    <p>
                      ✗ {packageSummary.leftOut} line{packageSummary.leftOut === 1 ? "" : "s"} had no
                      candidate in the required package and {packageSummary.leftOut === 1 ? "is" : "are"}{" "}
                      left out of the cart lists until you pick a part or skip.
                    </p>
                  )}
                  {packageSummary.mismatched > 0 && (
                    <p>
                      ✗ {packageSummary.mismatched} chosen part{packageSummary.mismatched === 1 ? " is" : "s are"} in
                      a different package than the BOM asks for.
                    </p>
                  )}
                  {packageSummary.unconfirmed > 0 && (
                    <p>
                      ⚠ {packageSummary.unconfirmed} chosen part{packageSummary.unconfirmed === 1 ? "'s" : "s'"} package
                      couldn&apos;t be confirmed against the BOM — check before ordering.
                    </p>
                  )}
                  {packageSummary.unspecified > 0 && (
                    <p className="text-amber-800 dark:text-amber-300">
                      {packageSummary.unspecified} IC/semiconductor line{packageSummary.unspecified === 1 ? " doesn't" : "s don't"}{" "}
                      say which package — the cheapest version was picked.
                    </p>
                  )}
                </div>
              )}
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-zinc-300 text-left dark:border-zinc-700">
                  <th className="py-2 pr-4">Part</th>
                  <th className="py-2 pr-4">Qty</th>
                  <th className="py-2 pr-4">Match</th>
                  <th className="py-2 pr-4">Price</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={i} className="border-b border-zinc-200 dark:border-zinc-800">
                    <td className="py-2 pr-4 font-mono">
                      {r.line.description} {r.line.value}
                    </td>
                    <td className="py-2 pr-4">{r.line.quantity}</td>
                    <td className="py-2 pr-4">
                      {r.candidates.length === 0 ? (
                        r.error ? `Error: ${r.error}` : "No match"
                      ) : (
                        <div className="flex flex-col gap-1">
                          <select
                            className="w-full max-w-md rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                            value={selectionFor(selections, r, i)}
                            onChange={(e) =>
                              setSelections((s) => ({ ...s, [i]: e.target.value }))
                            }
                          >
                            {selectionFor(selections, r, i) === NONE && (
                              <option value={NONE} disabled>
                                — no part in the required package; choose one —
                              </option>
                            )}
                            {r.candidates.slice(0, 5).map((c, ci) => (
                              <option key={ci} value={ci}>
                                [{c.confidence}] [{packageLabel(c)}] [{SUPPLIER_LABEL[c.part.supplier]}]{" "}
                                {c.part.price} — {c.part.description}
                              </option>
                            ))}
                            <option value={SKIP}>— skip this line —</option>
                          </select>
                          <PackageNote result={r} chosen={chosenCandidate(selections, r, i)} noneChosen={selectionFor(selections, r, i) === NONE} />
                          {(() => {
                            const chosen = chosenCandidate(selections, r, i);
                            if (!chosen) return null;
                            return (
                              <a
                                href={chosen.part.productUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="w-fit text-xs text-blue-600 underline dark:text-blue-400"
                              >
                                View on {SUPPLIER_LABEL[chosen.part.supplier]} →
                              </a>
                            );
                          })()}
                          {r.error && (
                            <span className="text-xs text-amber-600 dark:text-amber-500">
                              ⚠ {r.error} (showing results from the other supplier only)
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      {(() => {
                        const chosen = chosenCandidate(selections, r, i);
                        if (!chosen) return null;
                        return `${chosen.part.price} (${SUPPLIER_LABEL[chosen.part.supplier]})`;
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {totalCost !== null &&
              (totalCost.mixed ? (
                <p className="text-sm text-amber-600 dark:text-amber-500">
                  Chosen parts span more than one currency (Mouser is always
                  JPY; DigiKey follows the selected country above) — see
                  per-line prices rather than a single misleading total.
                </p>
              ) : (
                <p className="text-sm font-medium text-black dark:text-zinc-50">
                  Cheapest-combination total: {totalCost.symbol}
                  {totalCost.total.toFixed(2)}
                </p>
              ))}

            {(Object.keys(pasteListsBySupplier) as CartSelection["supplier"][]).map((supplier) => (
              <div
                key={supplier}
                className="flex flex-col gap-2 rounded-lg border border-zinc-300 p-4 dark:border-zinc-700"
              >
                <h2 className="text-sm font-semibold text-black dark:text-zinc-50">
                  {SUPPLIER_LABEL[supplier]} cart list
                </h2>
                <p className="text-xs text-zinc-600 dark:text-zinc-400">
                  Paste this into {SUPPLIER_LABEL[supplier]}&apos;s own{" "}
                  <a
                    href={SUPPLIER_BOM_TOOL_URL[supplier]}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    BOM tool
                  </a>{" "}
                  while signed in —{" "}
                  {supplier === "digikey"
                    ? "tab-separated columns: part number, quantity, note."
                    : "repeated part numbers are grouped into quantities automatically."}
                </p>
                <textarea
                  readOnly
                  className="h-32 w-full rounded-lg border border-zinc-300 bg-zinc-100 p-3 font-mono text-xs text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                  value={pasteListsBySupplier[supplier]}
                />
                <button
                  onClick={() => handleCopy(supplier)}
                  className="w-fit rounded-full bg-black px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
                >
                  {copied === supplier ? "Copied!" : "Copy list"}
                </button>
              </div>
            ))}
          </>
        )}
      </main>
    </div>
  );
}

// One line under each BOM row saying what package the BOM asks for and
// whether the chosen part is confirmed to be in it.
function PackageNote({
  result,
  chosen,
  noneChosen,
}: {
  result: MatchResult;
  chosen: RankedCandidate | undefined;
  noneChosen: boolean;
}) {
  const req = result.line.packageRequirement ?? [];
  const needs = req.length > 0 ? `Needs ${formatRequirement(req)}.` : null;
  const from = chosen?.pkg.source ? ` (from ${chosen.pkg.source})` : "";

  if (noneChosen) {
    return (
      <span className="text-xs text-red-600 dark:text-red-400">
        ✗ {needs} No candidate is confirmed in that package — left out of the cart lists. Pick one
        anyway or skip the line.
      </span>
    );
  }
  if (!chosen) return null;

  switch (chosen.pkg.status) {
    case "match":
      return (
        <span className="text-xs text-green-700 dark:text-green-400">
          ✓ {needs} This part is {chosen.pkg.found}
          {from}.
        </span>
      );
    case "mismatch":
      return (
        <span className="text-xs text-red-600 dark:text-red-400">
          ✗ {needs} This part is {chosen.pkg.found}
          {from}.
        </span>
      );
    case "unknown":
      return (
        <span className="text-xs text-amber-600 dark:text-amber-500">
          ⚠ {needs} This part&apos;s package couldn&apos;t be confirmed
          {chosen.pkg.found ? ` (only “${chosen.pkg.found}”${from})` : ""} — check the product page.
        </span>
      );
    default:
      if (!PACKAGE_SENSITIVE_KINDS.has(result.line.kind)) return null;
      return (
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          BOM doesn&apos;t name a package.
          {chosen.pkg.found ? ` This part is ${chosen.pkg.found}${from}.` : " This part's package is unknown."}
        </span>
      );
  }
}
