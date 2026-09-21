import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMouserPasteList, buildPasteListsBySupplier } from "../cart-builder.ts";

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
  assert.equal(bySupplier.digikey, "296-1234-ND");
});

test("omits a supplier entirely from the result when nothing was picked from it", () => {
  const bySupplier = buildPasteListsBySupplier([
    { supplier: "mouser", supplierPartNumber: "512-1N4148", quantity: 1 },
  ]);
  assert.equal("digikey" in bySupplier, false);
});
