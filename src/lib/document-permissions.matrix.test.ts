import {describe,it,expect} from "vitest";
import {DOCUMENT_PERMISSIONS,roleDocumentScope,roleDocumentPermission,canDocumentAction} from "./document-permissions";
const roles=["owner","admin","director","finance_manager","accountant","sales","cashier","hr","auditor","employee","viewer"];
const scopes=["quote","invoice","payslip","report"] as const;
function db(roleAllowed:null|boolean,userAllowed:null|boolean){
 const calls:string[]=[];
 return {calls,from:(table:string)=>{
  calls.push(table);
  const value=table==="role_permissions"?roleAllowed:userAllowed;
  const q:any={select:()=>q,eq:()=>q,maybeSingle:async (): Promise<any> => ({data:value===null?null:{allowed:value},error:null})};
  return q;
 }};
}
describe("ContrÃ´le documentaire : matrice exhaustive des rÃ´les existants",()=>{
 for(const role of roles)for(const scope of scopes)for(const permission of DOCUMENT_PERMISSIONS){
  it(role+" / "+scope+" / "+permission,async()=>{
   const supabase=db(null,null);
   const effective=await canDocumentAction({organizationId:"org_A",role,user:{id:"user_A"},supabase},permission,scope);
   expect(effective).toBe(roleDocumentScope(role,scope)&&roleDocumentPermission(role,permission));
   if(!roleDocumentScope(role,scope))expect(supabase.calls).toEqual([]);
  });
 }
 it("un refus individuel interdit toujours l'export, mÃªme au propriÃ©taire",async()=>{
  const supabase=db(null,false);
  expect(await canDocumentAction({organizationId:"org_A",role:"owner",user:{id:"user_A"},supabase},¶»§q«^