"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireOrganization } from "@/lib/current-org";
import { assertPermission } from "@/lib/permissions";

const countSchema = z.object({
  fiscal_year_id: z.string().uuid(),
  count_date: z.string().date(),
  valuation_method: z.enum(["CUMP","FIFO","specific_identification"]),
  notes: z.string().trim().max(2000).optional(),
});

const lineSchema = z.object({
  count_id: z.string().uuid(),
  item_reference: z.string().trim().min(1).max(80),
  description: z.string().trim().min(2).max(240),
  unit: z.string().trim().min(1).max(24).default("unité"),
  account_code: z.string().trim().regex(/^(31|32|33|34|35|36|37|38)\d{0,4}$/),
  quantity: z.coerce.number().finite().nonnegative(),
  unit_cost: z.coerce.number().finite().nonnegative(),
  impairment_amount: z.coerce.number().finite().nonnegative().default(0),
  impairment_account_code: z.preprocess((value)=>value===""||value==null?undefined:value,z.string().trim().regex(/^(391|392|393|394|395|397|398)$/).optional()),
}).superRefine((value,ctx)=>{
  if(value.impairment_amount>0&&!value.impairment_account_code){
    ctx.addIssue({code:z.ZodIssueCode.custom,path:["impairment_account_code"],message:"Le compte 39 est obligatoire en présence d'une dépréciation."});
  }
  if(value.impairment_account_code){
    const expected:Record<string,string>={"31":"391","32":"392","33":"393","34":"394","35":"395","37":"397","38":"398"};
    const prefix=expected[value.account_code.slice(0,2)];
    if(!prefix||!value.impairment_account_code.startsWith(prefix)){
      ctx.addIssue({code:z.ZodIssueCode.custom,path:["impairment_account_code"],message:"Le compte 39 doit correspondre à la famille du stock."});
    }
  }
  const gross=Math.round((value.quantity*value.unit_cost+Number.EPSILON)*100)/100;
  if(value.impairment_amount>gross){
    ctx.addIssue({code:z.ZodIssueCode.custom,path:["impairment_amount"],message:"La dépréciation dépasse la valeur brute du stock."});
  }
});

export async function createInventoryCount(formData: FormData) {
  const ctx=await requireOrganization();
  await assertPermission(ctx,"accounting.manage");
  const parsed=countSchema.safeParse(Object.fromEntries(formData));
  if(!parsed.success)throw new Error(parsed.error.issues[0]?.message||"Les paramètres de l'inventaire sont invalides.");
  const value=parsed.data;
  const {data:year,error:yearError}=await ctx.supabase.from("accounting_fiscal_years")
    .select("id,period_end").eq("organization_id",ctx.organizationId).eq("id",value.fiscal_year_id).single();
  if(yearError||!year)throw new Error("Exercice comptable introuvable.");
  if(value.count_date!==year.period_end)throw new Error("Le comptage physique doit être daté de la clôture de l'exercice.");
  const {data:existing,error:existingError}=await ctx.supabase.from("inventory_counts")
    .select("id,status").eq("organization_id",ctx.organizationId).eq("fiscal_year_id",value.fiscal_year_id)
    .in("status",["draft","approved"]).limit(1);
  if(existingError)throw new Error("Impossible de vérifier les inventaires existants.");
  if((existing||[]).length)throw new Error("Cet exercice possède déjà un inventaire brouillon ou approuvé. Contrepasser l'inventaire approuvé avant de le remplacer.");
  const {error}=await ctx.supabase.from("inventory_counts").insert({
    organization_id:ctx.organizationId,
    fiscal_year_id:value.fiscal_year_id,
    count_date:value.count_date,
    valuation_method:value.valuation_method,
    notes:value.notes||null,
    status:"draft",
  });
  if(error)throw new Error((error.message.includes("inventory_counts_one_draft_per_year")||error.message.includes("inventory_counts_one_active_per_year"))
    ?"Un inventaire brouillon existe déjà pour cet exercice."
    :"Impossible de créer l'inventaire : "+error.message);
  revalidatePath("/inventaires");
  revalidatePath("/etats-financiers");
  redirect("/inventaires");
}

export async function addInventoryCountLine(formData: FormData) {
  const ctx=await requireOrganization();
  await assertPermission(ctx,"accounting.manage");
  const parsed=lineSchema.safeParse(Object.fromEntries(formData));
  if(!parsed.success)throw new Error(parsed.error.issues[0]?.message||"La ligne d'inventaire est invalide.");
  const value=parsed.data;
  const {error}=await ctx.supabase.from("inventory_count_lines").insert({
    organization_id:ctx.organizationId,
    count_id:value.count_id,
    item_reference:value.item_reference,
    description:value.description,
    unit:value.unit,
    account_code:value.account_code,
    quantity:value.quantity,
    unit_cost:value.unit_cost,
    impairment_amount:value.impairment_amount,
    impairment_account_code:value.impairment_amount>0?value.impairment_account_code:null,
  });
  if(error)throw new Error("Impossible d'enregistrer la ligne d'inventaire : "+error.message);
  revalidatePath("/inventaires");
  revalidatePath("/etats-financiers");
}

export async function deleteInventoryCountLine(formData: FormData) {
  const ctx=await requireOrganization();
  await assertPermission(ctx,"accounting.manage");
  const id=z.string().uuid().parse(formData.get("line_id"));
  const {error}=await ctx.supabase.from("inventory_count_lines").delete()
    .eq("id",id).eq("organization_id",ctx.organizationId);
  if(error)throw new Error("Impossible de supprimer la ligne : "+error.message);
  revalidatePath("/inventaires");
  revalidatePath("/etats-financiers");
}

export async function approveInventoryCount(formData: FormData) {
  const ctx=await requireOrganization();
  await assertPermission(ctx,"accounting.manage");
  const id=z.string().uuid().parse(formData.get("count_id"));
  const {error}=await ctx.supabase.rpc("approve_inventory_count",{p_count_id:id});
  if(error)throw new Error("Impossible d'approuver l'inventaire : "+error.message);
  revalidatePath("/inventaires");
  revalidatePath("/etats-financiers");
}

export async function reverseInventoryCount(formData: FormData) {
  const ctx=await requireOrganization();
  await assertPermission(ctx,"accounting.manage");
  const id=z.string().uuid().parse(formData.get("count_id"));
  const reason=z.string().trim().min(10).max(1000).parse(formData.get("reason"));
  const {error}=await ctx.supabase.rpc("reverse_inventory_count",{p_count_id:id,p_reason:reason});
  if(error)throw new Error("Impossible de contrepasser l'inventaire : "+error.message);
  revalidatePath("/inventaires");
  revalidatePath("/etats-financiers");
  redirect("/inventaires");
}
