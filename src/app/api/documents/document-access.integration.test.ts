import {describe,it,expect,vi,beforeEach} from "vitest";
import {NextRequest} from "next/server";

const fixture=vi.hoisted(()=>({role:"viewer",organizationId:"org-a",calls:[] as string[]}));
vi.mock("@/lib/current-org",()=>({
 requireOrganization:async()=>({
   organizationId:fixture.organizationId,role:fixture.role,user:{id:"member-a"},
   supabase:{from:(table:string)=>{
     fixture.calls.push(table);
     const query:any={
       select:()=>query,eq:()=>query,order:()=>query,limit:()=>query,
       maybeSingle:async()=>({data:null,error:null}),
       single:async()=>({data:{name:"QA",currency:"MGA"},error:null})
     };
     return query;
   }}
 })
}));
vi.mock("@/lib/permissions",()=>({hasPermission:async()=>true,requirePermission:async()=>undefined}));
vi.mock("@/lib/payroll/payslip-document",()=>({
 loadPayslip:async()=>({
   ctx:{organizationId:fixture.organizationId,role:fixture.role,user:{id:"member-a"},
     supabase:{from:()=>({select(){return this},eq(){return this},maybeSingle:async()=>({data:null,error:null})})}},
   data:{number:"QA-BPA"}
 })
}));

import {GET as commercialGet} from "./[type]/[id]/pdf/route";
import {GET as payrollGet} from "../payroll/payslips/[id]/pdf/route";
import {GET as reportGet} from "../reports/summary/pdf/route";
import {POST as commercialEmail} from "./[type]/[id]/email/route";

beforeEach(()=>{fixture.role="viewer";fixture.calls=[]});
describe("Direct HTTP route authorization (mocked authenticated sessions)",()=>{
 for(const role of ["viewer","employee"]){
  for(const type of ["invoice","quote"]){
   it(role+" cannot download "+type+" PDF",async()=>{
     fixture.role=role;
     const response=await commercialGet(new Request("http://local/api/documents/"+type+"/doc-b"),{params:Promise.resolve({type,id:"doc-b"})});
     expect(response.status).toBe(403);
     expect(fixture.calls.filter(x=>x==="invoices"||x==="quotes")).toHaveLength(0);
   });
  }
  it(role+" cannot download payslip",async()=>{
    fixture.role=role;
    const response=await payrollGet(new Request("http://local/api/payroll/payslips/doc-b/pdf"),{params:Promise.resolve({id:"doc-b"})});
    expect(response.status).toBe(403);
  });
  it(role+" cannot download financial report",async()=>{
    fixture.role=role;
    const response=await reportGet();
    expect(response.status).toBe(403);
  });
  it(role+" cannot email invoice attachment",async()=>{
    fixture.role=role;
    const request=new NextRequest("http://local/api/documents/invoice/doc-b/email",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({to:"qa@example.invalid",subject:"QA",body:"QA"})});
    const response=await commercialEmail(request,{params:Promise.resolve({type:"invoice",id:"doc-b"})});
    expect(response.status).toBe(403);
  });
 }
 it("request for a foreign-organization invoice returns 404 even with accounting role",async()=>{
  fixture.role="accountant";
  const response=await commercialGet(new Request("http://local/api/documents/invoice/doc-b/pdf"),{params:Promise.resolve({type:"invoice",id:"doc-b"})});
  expect(response.status).toBe(404);
  expect(fixture.calls).toContain("invoices");
 });
});
