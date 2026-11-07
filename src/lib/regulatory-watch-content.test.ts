import { describe, expect, it } from "vitest";
import { normalizeRegulatoryHtml } from "./regulatory-watch-content";

describe("normalizeRegulatoryHtml", () => {
  it("removes scripts, styles and markup without losing visible text", () => {
    expect(normalizeRegulatoryHtml("<h1>Texte</h1><script>alert(1)</script><p>Loi 2026</p><style>.x{}</style>"))
      .toBe("Texte\nLoi 2026");
  });

  it("decodes common and numeric HTML entities", () => {
    expect(normalizeRegulatoryHtml("<p>Impôts &amp; taxes &#233; &#x1F1F2;</p>"))
      .toBe("Impôts & taxes é 🇲");
  });

  it("normalizes whitespace to avoid layout-only false positives", () => {
    expect(normalizeRegulatoryHtml("<div>  Nouveau   texte </div>\n <p>Deuxième ligne</p>"))
      .toBe("Nouveau texte\nDeuxième ligne");
  });

  it("does not throw on invalid numeric entities", () => {
    expect(normalizeRegulatoryHtml("<p>Code &#99999999; fin</p>")).toBe("Code fin");
  });
});
