import {describe,it,expect} from "vitest";
import { paletteFromRgba } from "./logo-palette";
describe("Charte initiale déduite du logo",()=>{
  it("retient des couleurs vives et écarte les pixels transparents",()=>{
    const rgba=new Uint8ClampedArray([
      0,0,0,0, 255,255,255,255,
      15,75,180,255, 18,78,185,255,
      240,85,20,255, 240,85,20,255,
    ]);
    const theme=paletteFromRgba(rgba);
    expect(theme.primaryColor).toMatch(/^#[0-9A-F]{6}$/);
    expect(theme.secondaryColor).toMatch(/^#[0-9A-F]{6}$/);
    expect(theme.primaryColor).not.toBe("#FFFFFF");
  });
  it("fournit une charte par défaut quand l'image n'a pas de couleur exploitable",()=>{
    const theme=paletteFromRgba(new Uint8ClampedArray([255,255,255,255]));
    expect(theme.primaryColor).toBe("#1663FF");
  });
});
