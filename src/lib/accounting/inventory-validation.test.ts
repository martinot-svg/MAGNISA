import { describe, expect, it } from "vitest";
import { isPcg2005StockAccountCode } from "./inventory-validation";

describe("isPcg2005StockAccountCode", () => {
  it.each(["31", "321", "335", "345", "355", "371", "38", "381"])(
    "accepts PCG 2005 stock account %s",
    (code) => expect(isPcg2005StockAccountCode(code)).toBe(true),
  );

  it.each(["30", "36", "39", "361", "396", "401", "512"])(
    "rejects non-stock or reserved PCG 2005 account %s",
    (code) => expect(isPcg2005StockAccountCode(code)).toBe(false),
  );
});
