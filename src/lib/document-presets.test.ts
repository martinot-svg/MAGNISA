import {describe,it,expect} from "vitest";
import {DOCUMENT_PRESETS,getDocumentPreset} from "./document-presets";
describe("Bibliothèque des modèles MAGNISA",()=>{
 it("possède 33 configurations identifiées",()=>{expect(DOCUMENT_PRESETS).toHaveLength(33);expect(new Set(DOCUMENT_PRESETS.map(x=>x.id)).size).toBe(33)});
 it("limite les types aux moteurs PDF existants",()=>expect(new Set(DOCUMENT_PRESETS.map(x=>x.type))).toEqual(new Set(["invoice","quote","payslip","report"])));
 it("présente neuf variantes de facture et huit variantes pour les autres moteurs",()=>{expect(DOCUMENT_PRESETS.filter(p=>p.type==="invoice")).toHaveLength(9);for(const type of ["quote","payslip","report"])expect(DOCUMENT_PRESETS.filter(p=>p.type===type)).toHaveLength(8)});
 it("conserve une provenance explicite",()=>{for(const p of DOCUMENT_PRESETS){expect(["MAGNISA original","user-provided design reference"]).toContain(p.provenance);expect(["proprietary","user-provided"]).toContain(p.license);expect(p.configuration.primaryColor).toMatch(/^#[0-9a-f]{6}$/)}});
 it("n'accepte pas d'identifiant inventé",()=>expect(getDocumentPreset("__nonexistent__")).toBeUndefined());
});
