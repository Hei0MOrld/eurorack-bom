import type { ParsedBomLine } from "./bom-parser.ts";
import { parseResistanceOhms, parseCapacitanceFarads, formatOhms, formatFarads } from "./value-normalizer.ts";

// Real Eurorack BOMs list acceptable alternates in one cell, e.g. "TL074 or
// UPC824" (verified: github.com/TOILmodular/TuringMachine BOM.md) — take the
// first option to search with. Exported so match-ranker.ts scores against
// the same part it actually searched for, not the untransformed "A or B"
// string (same class of bug the pedal-BOM parser hit with its JRC alias).
export function firstAlternateValue(value: string): string {
  return value.split(/\s+or\s+/i)[0].trim();
}

export function buildSearchKeyword(line: ParsedBomLine): string {
  const value = line.value.trim();

  switch (line.kind) {
    case "resistor": {
      const ohms = parseResistanceOhms(value);
      const display = ohms !== null ? formatOhms(ohms) : value;
      // Same relevance fix smart-bom's pedal parser needed: a bare "<value>
      // ohm resistor" query surfaces expensive high-wattage chassis
      // resistors sharing the same value. Eurorack builds use ordinary 1/4W
      // through-hole resistors just like pedal builds.
      return `${display} ohm resistor 1/4w axial`;
    }
    case "capacitor": {
      const farads = parseCapacitanceFarads(value);
      const display = farads !== null ? formatFarads(farads) : value;
      // The Description column (not handled here — see bom-parser.ts)
      // already told us electrolytic vs ceramic; that distinction isn't
      // preserved on ParsedBomLine today. Documented gap: this can surface
      // the wrong capacitor type for a value that exists in both, same as
      // smart-bom's capacitor type-hint problem before it added
      // extractCapacitorTypeHints. Revisit if live testing shows this
      // matters in practice for Eurorack BOMs specifically.
      return `${display} capacitor`;
    }
    case "ic":
      return firstAlternateValue(value); // part numbers (TL074, CD4015, etc.) search well as-is
    case "diode":
      return /\bled\b/i.test(value) || /\bled\b/i.test(line.description) ? `${value} LED` : `${value} diode`;
    case "transistor":
      return `${value} transistor`;
    case "potentiometer": {
      const isTrimmer = /\btrimmer\b/i.test(line.description);
      if (isTrimmer) return `${value} trimmer potentiometer`;
      return `${value} potentiometer`;
    }
    case "jack":
      // Verified live: this surfaces real 3.5mm mono jacks from both
      // suppliers (e.g. DigiKey's "CONN JACK MONO 3.5MM R/A").
      return `${value} mono jack panel mount`;
    case "header":
      // e.g. value "2.54mm Male 1x5" — searched close to verbatim since it
      // already names pitch, gender, and pin count. Unverified against live
      // results, same caveat as jack.
      return `${value} pin header connector`;
    case "switch":
      // Switch values are functional descriptions, not part numbers or
      // component values ("(ON)-OFF-(ON)", "1 Pole - 8 Positions") — there's
      // no reliable way to turn these into a precise supplier search.
      // Prefer the Note column when present (real example: "SPDT, Momentary
      // Spring Return Switch" is a far better search string than the literal
      // "(ON)-OFF-(ON)" value). This is a best-effort, most-likely-wrong-
      // sometimes path — flag it to the user in the UI rather than silently
      // presenting a low-confidence switch match as equally trustworthy.
      return line.note ? line.note : `${value} switch`;
    default:
      return `${line.description} ${value}`.trim();
  }
}
