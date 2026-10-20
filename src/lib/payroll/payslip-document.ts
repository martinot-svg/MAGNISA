import {requireOrganization} from "@/lib/current-org";
import {requirePermission} from "@/lib/permissions";
export async function loadPayslip(id:string){
 const ctx=await requireOrganization();await requirePermission(ctx,"payroll.view");
 const {supabase,organizationId}=ctx;
 const [{data:slip,error},{data:org},{data:settings},{data:pdfTemplate},{data:snapshot}]=await Promise.all([
  supabase.from("payslips").select("*,employees(first_name,last_name,email,employee_number,job_title),payroll_runs(period_start,period_end)").eq("organization_id",organizationId).eq("id",id).maybeSingle(),
  supabase.from("organizations").select("name,currency,smie_partner_name").eq("id",organizationId).single(),
  supabase.from("company_settings").select("trade_name,legal_name,address,logo_url,document_theme").eq("organization_id",organizationId).maybeSingle(),
  supabase.from("document_templates").select("configuration").eq("organization_id",organizationId).eq("document_type","payslip").eq("is_default",true).limit(1).maybeSingle(),
  supabase.from("document_appearance_snapshots").select("appearance").eq("organization_id",organizationId).eq("document_type","payslip").eq("document_id",id).maybeSingle()
 ]);
 if(error)throw new Error(error.message);if(!slip)return null;
 const periodEnd=String((slip as any).payroll_runs?.period_end||"");
 const {data:smieRules,error:smieError}=await supabase.from("payroll_rule_sets").select("smie_partner_name,effective_from,effective_to").eq("organization_id",organizationId).eq("status","validated").lte("effective_from",periodEnd).order("effective_from",{ascending:false});
 if(smieError)throw new Error(smieError.message);
 const smiePartner=(smieRules||[]).find((r:any)=>!r.effective_to||r.effective_to>=periodEnd)?.smie_partner_name||org?.smie_partner_name||null;
 const d:any=slip;const period=String(d.payroll_runs?.period_start||"")+" au "+String(d.payroll_runs?.period_end||"");const employee=[d.employees?.first_name,d.employees?.last_name].filter(Boolean).join(" ");const number="BPA-"+String(d.id).slice(0,8).toUpperCase();
 const captured=snapshot?.appearance as {company?:Record<string,any>;template?:Record<string,any>}|undefined;const isFinalized=String(d.status||"").toLowerCase()!=="draft";const appearance=isFinalized?captured:undefined;const visual=appearance?.company||settings;
 const logoUrl=visual?.logo_url||settings?.logo_url||null;
 const data={theme:visual?.document_theme,template:appearance?appearance.template:pdfTemplate?.configuration,smiePartner,logoUrl,company:visual?.trade_name||visual?.legal_name||org?.name||"Entreprise",address:visual?.address,employee,number,period,currency:org?.currency||"MGA",status:d.status,values:d as Record<string,number>};
 return {ctx,slip:d,data,email:String(d.employees?.email||"")};
}
