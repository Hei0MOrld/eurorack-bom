import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSearchKeyword, firstAlternateValue } from "../query-builder.ts";
import type { ParsedBomLine } from "../bom-parser.ts";

function line(overrides: Partial<ParsedBomLine>): ParsedBomLine {
  return {
    raw: "",
    description: "Resistor 1/4W",
    kind: "resistor",
    value: "100K",
    quantity: 1,
    note: "",
    ...overrides,
  };
}

test("firstAlternateValue takes the first option from an 'A or B' value", () => {
  assert.equal(firstAlternateValue("TL074 or UPC824"), "TL074");
  assert.equal(firstAlternateValue("TL072 or NJM4580"), "TL072");
  assert.equal(firstAlternateValue("CD4015"), "CD4015"); // no alternate — unchanged
});

test("ic keyword search resolves an 'A or B' value to just the first option", () => {
  const keyword = buildSearchKeyword(line({ kind: "ic", value: "TL074 or UPC824" }));
  assert.equal(keyword, "TL074");
});

test("switch keyword search prefers the Note over the functional value text", () => {
  const keyword = buildSearchKeyword(
    line({ kind: "switch", value: "(ON)-OFF-(ON)", note: "SPDT, Momentary Spring Return Switch" }),
  );
  assert.equal(keyword, "SPDT, Momentary Spring Return Switch");
});

test("switch keyword search falls back to the raw value when there's no Note", () => {
  const keyword = buildSearchKeyword(line({ kind: "switch", value: "1 Pole - 8 Positions", note: "" }));
  assert.equal(keyword, "1 Pole - 8 Positions switch");
});

test("jack keyword search includes the physical size from the value", () => {
  const keyword = buildSearchKeyword(line({ kind: "jack", value: "3.5mm" }));
  assert.match(keyword, /3\.5mm/);
  assert.match(keyword, /jack/i);
});

test("header keyword search passes the pitch/gender/pin-count value through", () => {
  const keyword = buildSearchKeyword(line({ kind: "header", value: "2.54mm Male 1x5" }));
  assert.match(keyword, /2\.54mm Male 1x5/);
});

test("trimmer (potentiometer with a Trimmer description) gets a trimmer-specific keyword", () => {
  const keyword = buildSearchKeyword(
    line({ kind: "potentiometer", description: "Trimmer", value: "1M", note: "Multi-Turn" }),
  );
  assert.match(keyword, /trimmer/i);
});

test("resistor keyword normalizes European notation and biases toward cheap through-hole parts", () => {
  const keyword = buildSearchKeyword(line({ kind: "resistor", value: "1.6K" }));
  assert.match(keyword, /1\.6k/i);
  assert.match(keyword, /1\/4w/i);
});
