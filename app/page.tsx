"use client";

import { useMemo, useState } from "react";
import type { ParsedBomLine } from "@/lib/bom-parser";
import type { RankedCandidate } from "@/lib/match-ranker";
import { buildPasteListsBySupplier, type CartSelection } from "@/lib/cart-builder";

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

export default function Home() {
  const [bomText, setBomText] = useState(SAMPLE_BOM);
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
        body: JSON.stringify({ bomText }),
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
      const sel = selections[i] ?? "0";
      if (sel === SKIP) return null;
      const candidate = r.candidates[parseInt(sel, 10)];
      if (!candidate) return null;
      const selection: CartSelection = {
        supplier: candidate.part.supplier,
        supplierPartNumber: candidate.part.supplierPartNumber,
        quantity: r.line.quantity,
      };
      return selection;
    });
    return buildPasteListsBySupplier(chosen.filter((c) => c !== null));
  }, [results, selections]);

  const totalCost = useMemo(() => {
    if (!results) return null;
    let total = 0;
    let anyPriced = false;
    results.forEach((r, i) => {
      const sel = selections[i] ?? "0";
      if (sel === SKIP) return;
      const candidate = r.candidates[parseInt(sel, 10)];
      if (!candidate) return;
      const price = parseFloat(candidate.part.price.replace(/[^\d.]/g, ""));
      if (Number.isFinite(price)) {
        total += price * r.line.quantity;
        anyPriced = true;
      }
    });
    return anyPriced ? total : null;
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
                            value={selections[i] ?? "0"}
                            onChange={(e) =>
                              setSelections((s) => ({ ...s, [i]: e.target.value }))
                            }
                          >
                            {r.candidates.slice(0, 5).map((c, ci) => (
                              <option key={ci} value={ci}>
                                [{c.confidence}] [{SUPPLIER_LABEL[c.part.supplier]}]{" "}
                                {c.part.price} — {c.part.description}
                              </option>
                            ))}
                            <option value={SKIP}>— skip this line —</option>
                          </select>
                          {(() => {
                            const chosen = r.candidates[parseInt(selections[i] ?? "0", 10)];
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
                        const chosen = r.candidates[parseInt(selections[i] ?? "0", 10)];
                        if (!chosen) return null;
                        return `${chosen.part.price} (${SUPPLIER_LABEL[chosen.part.supplier]})`;
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {totalCost !== null && (
              <p className="text-sm font-medium text-black dark:text-zinc-50">
                Cheapest-combination total: ¥{totalCost.toFixed(2)}
              </p>
            )}

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
                  while signed in — repeated part numbers are grouped into
                  quantities automatically.
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
