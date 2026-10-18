import {describe,it,expect} from "vitest";
import {formatDocumentAmount as f} from "./format-document-amount";
describe("Format monétaire compatible avec les PDF",()=>{
 it("affiche les milliers avec espace simple",()=>expect(f(400000,{currency:"MGA"})).toBe("400 000 MGA"));
 it("affiche une fraction avec virgule",()=>expect(f(400000.25,{currency:"MGA"})).toBe("400 000,25 MGA"));
 it("permet deux décimales fixes",()=>expect(f(5000,{currency:"Ar",showZeroDecimals:true})).toBe("5 000,00 Ar"));
 it("affiche les valeurs négatives",()=>expect(f(-12500.5,{currency:"Ar"})).toBe("-12 500,50 Ar"));
 it("autorise un affichage sans décimales",()=>expect(f(400000.2,{currency:"MGA",decimals:0})).toBe("400 000 MGA"));
 it("refuse NaN",()=>expect(()=>f(NaN)).toThrow());
});