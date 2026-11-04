import {describe,it,expect} from "vitest";
import {DOCUMENT_PERMISSIONS,roleDocumentPermission,roleDocumentScope,canDocumentAction} from "./document-permissions";
describe("Règles documentaires - refus par défaut",()=>{
 it("déclare exactement 17 permissions",()=>expect(new Set(DOCUMENT_PERMISSIONS).size).toBe(17));
 it("sépare la paie des rôles financiers et commerciaux",()=>{for(const r of ["finance_manager","accountant","director","sales","cashier","auditor","viewer","employee"])expect(roleDocumentScope(r,"payslip")).toBe(false)});
 it("restreint la RH au périmètre de paie",()=>{expect(roleDocumentScope("hr","payslip")).toBe(true);expect(roleDocumentScope("hr","invoice")).toBe(false)});
 it("ne donne pas de publication aux employés ou auditeurs",()=>{for(const r of ["employee","auditor","viewer","sales"])expect(roleDocumentPermission(r,"templates.publish")).toBe(false)});
 it("refuse les rôles inconnus",()=>{expect(roleDocumentScope("superadmin","invoice")).toBe(false);expect(roleDocumentPermission("unknown","documents.export")).toBe(false)});
 it("refuse par périmètre sans requête réseau",async()=>{const ctx={organizationId:"o",role:"accountant",supabase:{from:()=>{throw Error("query not expected")}}};expect(await canDocumentAction(ctx,"documents.export","payslip")).toBe(false)});
 it("respecte les refus explicitement enregistrés",async()=>{const q: any={select:()=>q,eq:()=>q,maybeSingle:async (): Promise<any> =>({data:{allowed:false},error:null})};expect(aw���q�^