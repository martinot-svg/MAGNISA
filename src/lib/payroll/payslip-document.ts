import {requireOrganization} from "@/lib/current-org";
import {requirePermission} from "@/lib/permissions";
export async function loadPayslip(id:string){
 const ctx=await requireOrganization();await requirePermission(ctx,"payroll.view");
 const {supabase,organizationId}=ctx;
 const [{data:slip,error},{data:org},{data:settings}]=await Promise.all([
  supabase.from("payslips").select("*,employees(first_name,last_name,email,employee_number,job_title),payroll_runs(period_start,period_end)").eq("organization_id",organizationId).eq("id",id).maybeSingle(),
  supabase.from("organizations").select("name,currency").eq("id",organizationId).single(),
  supabase.from("company_settings").select("trade_name,legal_name,address").eq("organization_id",organizationId).maybeSingle()
 ]);
 if(error)throw new Error(error.message);
 if(!slip)return null;
 const periodEnd=String((slip as any).payroll_runs?.period_end||"");
 const {data:smieRules,error:smieError}=await supabase.from("payroll_rule_sets").select("smie_partner_name,effective_from,effective_to").eq("organization_id",organizationId).eq("status","validated").lte("effective_from",periodEnd).order("effective_from",{ascending:false});
 if(smieError)throw new Error(smieError.message);
 const smiePartner=(smieRules||[]).find((r:any)=>!r.effective_to||r.effective_to>=periodEnd)?.smie_partner_name||null;
 const d:any=slip;
 const period=String(d.payroll_runs?.period_start||"")+" au "+String(d.payroll_runs?.period_end||"");
 const employee=[d.employees?.first_name,d.employees?.last_name].filter(Boolean).join(" ");
 const number="BPA-"+String(d.id).slice(0,8).toUpperCase();
 const data={smiePartner,company:settings?.trade_name||settings?.legal_name||org?.name||"Entreprise",address:settings?.address,employee,number,period,currency:org?.currency||"MGA",status:d.status,values:d as Record<string,number>};
 return {ctx,slip:d,data,email:String(d.employees?.email||"")};
}
