import {describe,it,expect} from "vitest";
import {DOCUMENT_PRESETS,getDocumentPreset} from "./document-presets";
describe("Bibliothèque originale MAGNISA",()=>{
 it("possède 32 configurations identifiées",()=>{expect(DOCUMENT_PRESETS).toHaveLength(32);expect(new Set(DOCUMENT_PRESETS.map(x=>x.id)).size).toBe(32)});
 it("limite les types aux moteurs PDF existants",()=>expect(new Set(DOCUMENT_PRESETS.map(x=>x.type))).toEqual(new Set(["invoice","quote","payslip","report"])));
 it("présente huit variantes par moteur",()=>{for(const type of ["invoice","quote","payslip","report"])expect(DOCUMENT_PRESETS.filter(p=>p.type===type)).toHaveLength(8)});
 it("ne référence aucun contenu externe",()=>{for(const p of DOCUMENT_PRESETS){expect(p.provenance).toBe("MAGNISA original");expect(p.license).toBe("proprietary");expect(p.configuration.primaryColor).toMatch(/^#[0-9a-f]{6}$/)}});
 it("n'accepte pas d'identifiant inventé",()=>expect(getDocumentPreset("__nonexistent__")).toBeUndefined());
});