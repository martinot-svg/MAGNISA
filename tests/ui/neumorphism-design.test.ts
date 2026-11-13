import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const contrast = (color: string) => {
  const channels = [1,3,5].map(pos => parseInt(color.slice(pos,pos+2),16)/255);
  const l = channels.map(v => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4);
  return 1.05/(.05 + .2126*l[0] + .7152*l[1] + .0722*l[2]);
};
describe("MAGNISA Neumorphism UI", () => {
  const css = read("src/app/magnisa-neumorphism.css");
  const shell = read("src/components/app-workspace.tsx");
  it("reprend précisément les huit couleurs de marque", () => {
    for (const hex of ["#01D1FC","#0058F1","#0A25CF","#4635FA","#8A21F5","#C314FB","#3B0592","#0C1A4B"])
      expect(css).toContain(hex);
  });
  it("les couleurs de texte principales respectent 5,4:1 sur blanc", () => {
    for (const color of ["#0C1A4B","#243652","#51617B","#0058F1","#385BB8"])
      expect(contrast(color)).toBeGreaterThanOrEqual(5.4);
  });
  it("conserve la navigation accessible sur mobile et sur ordinateur", () => {
    expect(shell).toContain('event.key === "Escape"');
    expect(shell).toContain('aria-current={active ? "page" : undefined}');
    expect(shell).toContain('inert={narrow && !open}');
    expect(css).toContain("max-width:1023px");
    expect(css).toContain("max-width:620px");
  });
  it("utilise Motion React sans mouvement obligatoire", () => {
    expect(shell).toContain('from "motion/react"');
    expect(shell).toContain('reducedMotion="user"');
    expect(css).toContain("prefers-reduced-motion:reduce");
    expect(read("src/components/modal-frame.tsx")).toContain("useReducedMotion");
  });
});
