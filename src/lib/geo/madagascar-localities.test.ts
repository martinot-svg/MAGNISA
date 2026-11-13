import { describe, expect, it } from "vitest";
import { resolveLocality, suggestMadagascarLocalities } from "./madagascar-localities";

describe("Madagascar national locality suggestions", () => {
  it("finds Ambahikily in Morombe without redirecting to Toliara", () => {
    const options = suggestMadagascarLocalities("908","Ambahikily",20);
    const result = options.find(x => x.name === "Ambahikily" && x.district === "Morombe");
    expect(result).toBeDefined();
    expect(result?.commune).toBe("Ambahikily");
    expect(result?.ref && resolveLocality(result.ref,"908")).toEqual(result);
  });
  it("finds Ambalavao in Haute Matsiatra and keeps the district context", () => {
    const options = suggestMadagascarLocalities("916","Ambalavao");
    expect(options.some(x => x.name === "Ambalavao" && x.district === "Ambalavao")).toBe(true);
  });
  it("prevents a locality reference from crossing registration regions", () => {
    const option = suggestMadagascarLocalities("908","Ambahikily")[0];
    expect(option).toBeDefined();
    expect(resolveLocality(option.ref,"916")).toBeNull();
    expect(resolveLocality("f:9999999","908")).toBeNull();
    expect(suggestMadagascarLocalities("000","Ambahikily")).toEqual([]);
  });
  it("handles accents, two-character searches and disallows unrestricted browsing", () => {
    expect(suggestMadagascarLocalities("908","a")).toEqual([]);
    expect(suggestMadagascarLocalities("916","Ambalaváo").length).toBeGreaterThan(0);
    expect(suggestMadagascarLocalities("908","Ambahikily").some(x => x.district === "Morombe")).toBe(true);
  });
});
