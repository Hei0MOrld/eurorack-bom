import { test } from "node:test";
import assert from "node:assert/strict";
import { rankCandidates } from "../match-ranker.ts";
import type { SupplierPart } from "../supplier-types.ts";
import type { ParsedBomLine } from "../bom-parser.ts";

function part(overrides: Partial<SupplierPart>): SupplierPart {
  return {
    supplier: "mouser",
    supplierPartNumber: "TEST",
    manufacturer: "Test Mfg",
    manufacturerPartNumber: "TEST-PN",
    description: "",
    price: "$0.10",
    availability: "In Stock",
    productUrl: "#",
    ...overrides,
  };
}

function line(overrides: Partial<ParsedBomLine>): ParsedBomLine {
  return {
    raw: "",
    description: "",
    kind: "switch",
    value: "",
    quantity: 1,
    note: "",
    ...overrides,
  };
}

test("switch/jack/header candidates are always 'unknown' confidence — no verifiable target value exists", () => {
  const candidates = [
    part({ description: "SPDT Toggle Switch ON-OFF-ON", price: "$1.20" }),
    part({ description: "Some other switch", price: "$0.50" }),
  ];
  const ranked = rankCandidates(line({ kind: "switch" }), candidates);
  assert.ok(ranked.every((r) => r.confidence === "unknown"));
});

test("switch/jack/header candidates still sort cheapest-first within their single confidence tier", () => {
  const candidates = [part({ price: "$1.20" }), part({ price: "$0.50" }), part({ price: "$0.80" })];
  const ranked = rankCandidates(line({ kind: "jack" }), candidates);
  assert.deepEqual(
    ranked.map((r) => r.part.price),
    ["$0.50", "$0.80", "$1.20"],
  );
});

test("a mocked $0.00 placeholder never outranks a real result, even in the always-unknown switch/jack/header path", () => {
  const real = part({ price: "$1.20" });
  const placeholder = part({ supplier: "digikey", supplierPartNumber: "MOCK-DK-0000", price: "$0.00" });
  const ranked = rankCandidates(line({ kind: "header" }), [placeholder, real]);
  assert.equal(ranked[0].part.supplierPartNumber, "TEST");
});

test("ic substring matching resolves an 'A or B' alternate value before scoring", () => {
  const candidates = [part({ manufacturerPartNumber: "TL074", description: "OP AMP QUAD JFET" })];
  const ranked = rankCandidates(
    line({ kind: "ic", value: "TL074 or UPC824" }),
    candidates,
  );
  assert.equal(ranked[0].confidence, "exact");
});

test("a real (non-mock) $0 price never wins a tiebreak either — treated as unpriced, sorted last", () => {
  const zeroPrice = part({ supplierPartNumber: "REAL-BUT-ZERO", price: "¥0" });
  const realPrice = part({ supplierPartNumber: "REAL-PRICED", price: "¥140" });
  const ranked = rankCandidates(line({ kind: "jack" }), [zeroPrice, realPrice]);
  assert.equal(ranked[0].part.supplierPartNumber, "REAL-PRICED");
});
