import type { SupplierPart } from "./supplier-types.ts";

// Builds a paste-ready list for Mouser's own BOM Tool (mouser.com/en/Bom/,
// "Copy & Paste" import method). Confirmed real usage pattern (Aion FX's own
// pedal-building guide, aionfx.com/resources/using-mouser-bom-tool-for-easy-
// parts-sourcing/): paste a plain list of Mouser part numbers — "items
// appearing more than once will be automatically grouped into quantities
// during the import", so repeating a part number N times is how you specify
// quantity N, no separate quantity column needed.
export interface CartSelection {
  supplier: SupplierPart["supplier"];
  supplierPartNumber: string;
  quantity: number;
  // Optional free-text label (e.g. the BOM line's description and value).
  // Only used by the DigiKey list, where it becomes the third column.
  note?: string;
}

export function buildMouserPasteList(selections: CartSelection[]): string {
  const lines: string[] = [];
  for (const { supplierPartNumber, quantity } of selections) {
    if (!supplierPartNumber || quantity < 1) continue;
    for (let i = 0; i < quantity; i++) lines.push(supplierPartNumber);
  }
  return lines.join("\n");
}

// DigiKey list: tab-separated rows of part number, quantity, and (only if
// any row has one) a note. Tabs rather than commas because notes come from
// BOM text that often contains commas ("SPDT, Momentary Spring Return
// Switch"), and tab-separated text also pastes straight into a spreadsheet
// as columns. Rows are merged only when both the part number AND the note
// match, so the same part picked for two BOM lines with different notes
// (e.g. a matched set vs. general use) stays on two separate rows.
// NOT yet verified against a live DigiKey account — confirm the import UI
// accepts this column order once there's a real account to test against.
export function buildDigiKeyPasteList(selections: CartSelection[]): string {
  const rows = new Map<string, { pn: string; quantity: number; note: string }>();
  for (const { supplierPartNumber, quantity, note } of selections) {
    const pn = supplierPartNumber.trim();
    if (!pn || quantity < 1) continue;
    const cleanNote = cleanCell(note ?? "");
    const key = `${pn}\t${cleanNote}`;
    const row = rows.get(key) ?? { pn, quantity: 0, note: cleanNote };
    row.quantity += quantity;
    rows.set(key, row);
  }
  const includeNotes = [...rows.values()].some((r) => r.note !== "");
  return [...rows.values()]
    .map(({ pn, quantity, note }) => {
      const cells = [pn, String(quantity)];
      if (includeNotes) cells.push(note);
      return cells.join("\t");
    })
    .join("\n");
}

// Tabs or newlines inside a note would break the column layout.
function cleanCell(text: string): string {
  return text.replace(/[\t\r\n]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

// Splits a flat selection list into one paste list per supplier, since a
// cross-vendor comparison naturally produces a mix of cheapest-per-line
// picks across both suppliers rather than one single list.
export function buildPasteListsBySupplier(
  selections: CartSelection[],
): Partial<Record<SupplierPart["supplier"], string>> {
  const bySupplier: Record<string, CartSelection[]> = {};
  for (const sel of selections) {
    (bySupplier[sel.supplier] ??= []).push(sel);
  }
  const result: Partial<Record<SupplierPart["supplier"], string>> = {};
  if (bySupplier.mouser) result.mouser = buildMouserPasteList(bySupplier.mouser);
  if (bySupplier.digikey) result.digikey = buildDigiKeyPasteList(bySupplier.digikey);
  return result;
}
