import type { ParsedBomLine } from "./bom-parser.ts";
import type { SupplierPart } from "./supplier-types.ts";
import { parseResistanceOhms, parseCapacitanceFarads } from "./value-normalizer.ts";
import { firstAlternateValue } from "./query-builder.ts";
import { checkPackage, type PackageCheck } from "./package.ts";

export interface RankedCandidate {
  part: SupplierPart;
  // How well the part's VALUE matches (resistance, capacitance, part number).
  confidence: "exact" | "possible" | "unknown";
  // Whether the part's PACKAGE matches what the BOM line asks for — a
  // separate question, so "exact" no longer silently covers a wrong
  // footprint (TL074 in SOIC-14 when the BOM said DIP-14).
  pkg: PackageCheck;
}

// Value ranking below runs first, without package information.
type ValueRanked = Omit<RankedCandidate, "pkg">;

// Same extraction/tie-break helpers smart-bom's pedal-BOM ranker uses —
// duplicated rather than shared across the two small projects (per-project
// simplicity over a shared package for two files; revisit if a third
// BOM-matching project shows up).
function extractResistanceOhms(description: string): number | null {
  const withUnitWord = description.match(/(\d+\.?\d*)\s*(k|K|M|R)?\s*(?:OHM|Ω)/i);
  if (withUnitWord) {
    const [, num, unitChar] = withUnitWord;
    return parseResistanceOhms(`${num}${unitChar ?? ""}`);
  }
  const bareValue = description.match(/\b(\d+\.?\d*)\s*(k|K|M|R)\b(?!\w)/);
  if (bareValue) {
    const [, num, unitChar] = bareValue;
    return parseResistanceOhms(`${num}${unitChar}`);
  }
  return null;
}

function extractCapacitanceFarads(description: string): number | null {
  const match = description.match(/(\d+\.?\d*)\s*(p|n|u|µ|m)F/i);
  if (!match) return null;
  const [, num, unitChar] = match;
  return parseCapacitanceFarads(`${num}${unitChar}F`);
}

function nearlyEqual(a: number, b: number): boolean {
  if (a === b) return true;
  return Math.abs(a - b) / Math.max(a, b) < 0.01;
}

function parsePrice(price: string): number {
  const cleaned = price.replace(/[^\d.]/g, "");
  const value = parseFloat(cleaned);
  if (!Number.isFinite(value)) return Infinity;
  // A real (non-mock) supplier listing priced at exactly 0 is a data-quality
  // signal (inactive/no-price-available/call-for-quote), not an actual free
  // part — verified live: DigiKey returned a "CONN JACK MONO 3.5MM R/A" at
  // ¥0 that won every price tiebreak ahead of genuinely purchasable ¥140+
  // jacks. Same root issue as the $0.00 mock placeholder, different cause —
  // treat it the same way (sort last, not first).
  if (value === 0) return Infinity;
  return value;
}

// Same placeholder-never-wins fix smart-bom's pedal-BOM ranker needed — a
// supplier client with no live credentials returns a "MOCK-..." part priced
// at $0.00, which would otherwise always win a price tiebreak.
function isPlaceholder(candidate: ValueRanked): boolean {
  return candidate.part.supplierPartNumber.startsWith("MOCK");
}

function byConfidenceThenPrice(a: ValueRanked, b: ValueRanked): number {
  const aPlaceholder = isPlaceholder(a);
  const bPlaceholder = isPlaceholder(b);
  if (aPlaceholder !== bPlaceholder) return aPlaceholder ? 1 : -1;

  const rank = { exact: 0, possible: 1, unknown: 2 };
  const rankDiff = rank[a.confidence] - rank[b.confidence];
  if (rankDiff !== 0) return rankDiff;
  return parsePrice(a.part.price) - parsePrice(b.part.price);
}

function scoreByExtractedValue(
  candidates: SupplierPart[],
  target: number | null,
  extract: (description: string) => number | null,
): ValueRanked[] {
  const scored = candidates.map((part) => {
    const extracted = extract(part.description);
    let confidence: ValueRanked["confidence"] = "unknown";
    if (target !== null && extracted !== null) {
      confidence = nearlyEqual(target, extracted) ? "exact" : "possible";
    } else if (extracted !== null) {
      confidence = "possible";
    }
    return { part, confidence };
  });
  return scored.sort(byConfidenceThenPrice);
}

function scoreBySubstring(candidates: SupplierPart[], needle: string): ValueRanked[] {
  const cleanNeedle = needle.toLowerCase().replace(/\s+/g, "");
  const scored: ValueRanked[] = candidates.map((part) => {
    const haystack = (part.manufacturerPartNumber + " " + part.description)
      .toLowerCase()
      .replace(/\s+/g, "");
    return { part, confidence: haystack.includes(cleanNeedle) ? "exact" : "unknown" };
  });
  return scored.sort(byConfidenceThenPrice);
}

// Value first, then package, then price. Value outranks package on
// purpose: a different chip in the right package is a worse pick than the
// right chip whose package couldn't be confirmed. Within the same value
// confidence, a confirmed package match beats an unconfirmed one, and a
// confirmed mismatch goes last.
const PACKAGE_ORDER: Record<PackageCheck["status"], number> = {
  match: 0,
  unspecified: 0,
  unknown: 1,
  mismatch: 2,
};
const CONFIDENCE_ORDER: Record<RankedCandidate["confidence"], number> = { exact: 0, possible: 1, unknown: 2 };

export function rankCandidates(line: ParsedBomLine, candidates: SupplierPart[]): RankedCandidate[] {
  const requirement = line.packageRequirement ?? [];
  return rankByValue(line, candidates)
    .map((c) => ({ ...c, pkg: checkPackage(requirement, c.part) }))
    .sort((a, b) => {
      const aPlaceholder = isPlaceholder(a);
      const bPlaceholder = isPlaceholder(b);
      if (aPlaceholder !== bPlaceholder) return aPlaceholder ? 1 : -1;
      const byValue = CONFIDENCE_ORDER[a.confidence] - CONFIDENCE_ORDER[b.confidence];
      if (byValue !== 0) return byValue;
      const byPackage = PACKAGE_ORDER[a.pkg.status] - PACKAGE_ORDER[b.pkg.status];
      if (byPackage !== 0) return byPackage;
      return parsePrice(a.part.price) - parsePrice(b.part.price);
    });
}

// The index of the candidate the page should pick by default, or null when
// even the best candidate is a confirmed package mismatch — then nothing is
// picked silently and the line is flagged instead.
export function defaultCandidateIndex(ranked: RankedCandidate[]): number | null {
  if (ranked.length === 0) return null;
  return ranked[0].pkg.status === "mismatch" ? null : 0;
}

function rankByValue(line: ParsedBomLine, candidates: SupplierPart[]): ValueRanked[] {
  if (line.kind === "resistor") {
    const target = parseResistanceOhms(line.value);
    return scoreByExtractedValue(candidates, target, extractResistanceOhms);
  }

  if (line.kind === "capacitor") {
    const target = parseCapacitanceFarads(line.value);
    const ranked = scoreByExtractedValue(candidates, target, extractCapacitanceFarads);

    // Real bug found via live testing (not caught by unit tests): a "10uF"
    // Electrolytic line matched a real 0402 ceramic capacitor at "exact"
    // confidence — same value, wrong physical type, not actually the right
    // part for a build calling for an electrolytic. Unlike smart-bom's
    // pedal-BOM parser (which has to guess a type hint from a parenthetical
    // note buried in the value column), the Eurorack BOM format states the
    // type directly in the Description column ("Capacitor Electrolytic",
    // "Capacitor Ceramic", or bare "Ceramic") — use that directly instead.
    const descLower = line.description.toLowerCase();
    const typeHint = descLower.includes("electrolytic")
      ? "electrolytic"
      : descLower.includes("ceramic")
        ? "ceramic"
        : null;
    if (!typeHint) return ranked;

    return ranked
      .map((candidate) => {
        if (candidate.confidence !== "exact") return candidate;
        const partDesc = candidate.part.description.toLowerCase();
        // Real supplier descriptions abbreviate as often as they spell out
        // the type ("CAP CER 0.1UF", "CAP ALUM 10UF") — verified live
        // against both Mouser and DigiKey results this session.
        const matchesType =
          typeHint === "electrolytic"
            ? /electrolytic|tantalum|\balum\b/.test(partDesc)
            : /ceramic|mlcc|film|\bcer\b/.test(partDesc);
        return matchesType ? candidate : { ...candidate, confidence: "possible" as const };
      })
      .sort(byConfidenceThenPrice);
  }

  if (line.kind === "potentiometer") {
    const target = parseResistanceOhms(line.value.replace(/^[A-Z]/, "")); // strip a leading taper letter, e.g. "B50K" -> "50K"
    return scoreByExtractedValue(candidates, target, extractResistanceOhms);
  }

  if (line.kind === "ic" || line.kind === "diode" || line.kind === "transistor") {
    return scoreBySubstring(candidates, firstAlternateValue(line.value));
  }

  // jack/header/switch: no numeric value and no reliable part-number needle
  // to score against (a switch's "value" is a functional description like
  // "(ON)-OFF-(ON)", not a searchable identifier) — there's no honest way to
  // call any result "exact" here. Sort by price only and surface everything
  // as "unknown" so the UI doesn't overstate confidence in a match that
  // wasn't actually verified against the target part.
  return candidates.map((part) => ({ part, confidence: "unknown" as const })).sort(byConfidenceThenPrice);
}
