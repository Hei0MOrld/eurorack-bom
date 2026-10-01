import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDigiKeyPasteList,
  buildMouserPasteList,
  buildPasteListsBySupplier,
} from "../cart-builder.ts";

test("repeats each part number once per unit of quantity", () => {
  const list = buildMouserPasteList([
    { supplier: "mouser", supplierPartNumber: "588-OK4725E-R52", quantity: 4 },
    { supplier: "mouser", supplierPartNumber: "512-1N4148", quantity: 1 },
  ]);
  assert.equal(
    list,
    "588-OK4725E-R52\n588-OK4725E-R52\n588-OK4725E-R52\n588-OK4725E-R52\n512-1N4148",
  );
});

test("skips entries with no part number or non-positive quantity", () => {
  const list = buildMouserPasteList([
    { supplier: "mouser", supplierPartNumber: "", quantity: 3 },
    { supplier: "mouser", supplierPartNumber: "512-1N4148", quantity: 0 },
    { supplier: "mouser", supplierPartNumber: "588-OK4725E-R52", quantity: 2 },
  ]);
  assert.equal(list, "588-OK4725E-R52\n588-OK4725E-R52");
});

test("splits a mixed-supplier selection into one paste list per supplier", () => {
  const bySupplier = buildPasteListsBySupplier([
    { supplier: "mouser", supplierPartNumber: "588-OK4725E-R52", quantity: 2 },
    { supplier: "digikey", supplierPartNumber: "296-1234-ND", quantity: 1 },
    { supplier: "mouser", supplierPartNumber: "512-1N4148", quantity: 1 },
  ]);
  assert.equal(bySupplier.mouser, "588-OK4725E-R52\n588-OK4725E-R52\n512-1N4148");
  assert.equal(bySupplier.digikey, "296-1234-ND\t1");
});

test("omits a supplier entirely from the result when nothing was picked from it", () => {
  const bySupplier = buildPasteListsBySupplier([
    { supplier: "mouser", supplierPartNumber: "512-1N4148", quantity: 1 },
  ]);
  assert.equal("digikey" in bySupplier, false);
});

test("DigiKey list is one tab-separated row per part: part number, quantity", () => {
  const list = buildDigiKeyPasteList([
    { supplier: "digikey", supplierPartNumber: "CF14JT100KCT-ND", quantity: 15 },
    { supplier: "digikey", supplierPartNumber: "1N4148FS-ND", quantity: 1 },
  ]);
  assert.equal(list, "CF14JT100KCT-ND\t15\n1N4148FS-ND\t1");
});

test("DigiKey list adds a note column when any row has a note", () => {
  const list = buildDigiKeyPasteList([
    { supplier: "digikey", supplierPartNumber: "CF14JT100KCT-ND", quantity: 15, note: "Resistor 1/4W 100K" },
    { supplier: "digikey", supplierPartNumber: "1N4148FS-ND", quantity: 1 },
  ]);
  assert.equal(list, "CF14JT100KCT-ND\t15\tResistor 1/4W 100K\n1N4148FS-ND\t1\t");
});

test("DigiKey list keeps the same part on separate rows when notes differ", () => {
  const list = buildDigiKeyPasteList([
    { supplier: "digikey", supplierPartNumber: "RNF14FTD10K0CT-ND", quantity: 4, note: "R1–R4, matched set" },
    { supplier: "digikey", supplierPartNumber: "", quantity: 2, note: "ignored" },
    { supplier: "digikey", supplierPartNumber: "RNF14FTD10K0CT-ND", quantity: 5, note: "R5–R8, R10" },
  ]);
  assert.equal(list, "RNF14FTD10K0CT-ND\t4\tR1–R4, matched set\nRNF14FTD10K0CT-ND\t5\tR5–R8, R10");
});

test("DigiKey list merges the same part only when the notes match too", () => {
  const list = buildDigiKeyPasteList([
    { supplier: "digikey", supplierPartNumber: "PJ398SM-ND", quantity: 2, note: "Mono Jack\tinputs" },
    { supplier: "digikey", supplierPartNumber: "PJ398SM-ND", quantity: 3, note: "Mono Jack inputs" },
    { supplier: "digikey", supplierPartNumber: "1N4148FS-ND", quantity: 1 },
    { supplier: "digikey", supplierPartNumber: "1N4148FS-ND", quantity: 2 },
  ]);
  assert.equal(list, "PJ398SM-ND\t5\tMono Jack inputs\n1N4148FS-ND\t3\t");
});
