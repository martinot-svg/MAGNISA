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
       maybeSingle:async (): Promise<any> => ({data:null,error:null}),
       single:async (): Promise<any> => ({data:{name:"QA",currency:"MGA"},error:null})
     };
     return query;
   }}
 })
}));
vi.mock("@/lib/permissions",()=>({hasPermission:async (): Promise<boolean> => true,requirePermission:async (): Promise<void> => undefined}));
vi.mock("@/lib/payroll/payslip-document",()=>({
 loadPayslip:async (): Promise<any> => ({
   ctx:{organizationId:fixture.organizationId,role:fixture.role,user:{id:"member-a"},
     supabase:{from:()=>({select(){return this},eq(){return this},maybeSingle:async (): Promise<any> => ({data:null,error:null})})}},
   data:{number:"QA-BPA"}
 })
}));

import {GET as commercialGet} from "./[type]/[id]/pdf/route";
import {GET as payrollGet} from "../payroll/payslips/[id]/pdf/route";
import {GET as reportGet} from "../reports/summary/pdf/route";
import {POST as commercialEmail} from "./[type]/[id]/email/route";

beforeEach(()=>{fixture.role="viewer";fixture.c¶»§q«^