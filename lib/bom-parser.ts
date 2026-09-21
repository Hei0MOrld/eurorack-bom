// Parses the Eurorack DIY community's real BOM format — verified against
// github.com/TOILmodular/TuringMachine/blob/main/BOM/BOM.md (a fork of Music
// Thing Modular's Turing Machine, a well-known open-source Eurorack module):
// a Markdown pipe-table with columns `| Description | Value | Quantity | Note |`.
// This is structurally different from every PedalPCB format smart-bom
// handles — there's no reference designator at all, and the "kind" of each
// part must be inferred from free-text words in the Description column
// instead (e.g. "Resistor 1/4W", "Op Amp", "Mono Jack", "Toggle Switch").

export type ComponentKind =
  | "resistor"
  | "capacitor"
  | "ic"
  | "diode"
  | "transistor"
  | "potentiometer"
  | "jack" // Eurorack-specific: 3.5mm mono jacks — not a kind smart-bom's pedal parser needed
  | "header" // Eurorack-specific: 2.54mm pin headers/connectors between boards
  | "switch" // Eurorack-specific: toggle/rotary switches with non-numeric values
  | "other";

export interface ParsedBomLine {
  raw: string;
  description: string;
  kind: ComponentKind;
  value: string;
  quantity: number;
  note: string;
}

// Ordered description -> kind rules. Order matters: IC sub-types that
// happen to contain the word "switch" ("Bilateral Switch IC") must be
// checked before the generic switch rule, or they'd misclassify.
const KIND_RULES: Array<{ pattern: RegExp; kind: ComponentKind }> = [
  { pattern: /\bled\b/i, kind: "diode" },
  { pattern: /\bdiode\b/i, kind: "diode" },
  { pattern: /\btransistor\b/i, kind: "transistor" },
  { pattern: /\btrimmer\b/i, kind: "potentiometer" },
  { pattern: /\bpotentiometer\b/i, kind: "potentiometer" },
  { pattern: /\bresistor\b/i, kind: "resistor" },
  { pattern: /\b(capacitor|ceramic|electrolytic)\b/i, kind: "capacitor" },
  {
    // Catches every IC-family part named by function rather than "IC" —
    // real examples from the Turing Machine BOM: "Op Amp", "Shift Register",
    // "Bilateral Switch IC", "Hex Buffer/Converter", "Quad AND Gate", "DAC",
    // "Shunt Voltage Regulator", "Voltage Regulator".
    pattern: /\b(op amp|shift register|bilateral switch|buffer|gate|dac|regulator|\bic\b)\b/i,
    kind: "ic",
  },
  { pattern: /\bjack\b/i, kind: "jack" },
  { pattern: /\bheader\b/i, kind: "header" },
  { pattern: /\bswitch\b/i, kind: "switch" },
];

function classifyKind(description: string): ComponentKind {
  for (const { pattern, kind } of KIND_RULES) {
    if (pattern.test(description)) return kind;
  }
  return "other";
}

// Splits a markdown table row like "| Resistor 1/4W | 1K | 3 | |" into
// trimmed cells, dropping the leading/trailing empty strings a pipe-bounded
// row produces. Real fixture data has ragged whitespace around cells
// ("|1 | " for one row's quantity) — always trim.
function splitTableRow(line: string): string[] {
  const cells = line.split("|").map((c) => c.trim());
  // A well-formed "| a | b | c |" row splits into ["", "a", "b", "c", ""] —
  // drop the empty bookends produced by the leading/trailing pipe.
  if (cells[0] === "") cells.shift();
  if (cells[cells.length - 1] === "") cells.pop();
  return cells;
}

// A markdown table separator row ("| --- | --- | --- | --- |" or with
// alignment colons) has every cell made of only dashes/colons — distinguish
// this from a real data row before parsing quantities out of it.
function isSeparatorRow(cells: string[]): boolean {
  return cells.every((c) => /^:?-+:?$/.test(c));
}

export function parseBomText(text: string): ParsedBomLine[] {
  const lines: ParsedBomLine[] = [];

  for (const rawLine of text.split("\n")) {
    const trimmed = rawLine.trim();
    if (!trimmed.startsWith("|")) continue; // not a table row (heading, blank line, footnote prose)

    const cells = splitTableRow(trimmed);
    if (cells.length < 3) continue; // malformed/short row, not a real data line
    if (isSeparatorRow(cells)) continue; // the "| --- | --- |" header divider
    if (/^description$/i.test(cells[0])) continue; // the header row itself

    const [description, value = "", quantityRaw = "", note = ""] = cells;
    if (!description) continue;

    const quantity = parseInt(quantityRaw, 10);
    if (!Number.isFinite(quantity) || quantity <= 0) continue; // a stray non-data row (e.g. footnote text that happens to contain pipes)

    lines.push({
      raw: trimmed,
      description,
      kind: classifyKind(description),
      value,
      quantity,
      note,
    });
  }

  return lines;
}
