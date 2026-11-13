"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/current-org";
import { companyOnboardingSchema } from "@/lib/company/onboarding-schema";
import { resolveLocality } from "@/lib/geo/madagascar-localities";

export type CreateCompanyState = { error: string | null; organizationId: string | null };
const invalidState = (error: string): CreateCompanyState => ({ error, organizationId:null });

export async function createCompanyFromForm(
  _: CreateCompanyState, formData: FormData,
): Promise<CreateCompanyState> {
  let raw: unknown;
  try { raw = JSON.parse(String(formData.get("payload") || "")); }
  catch { return invalidState("Le formulaire n'est pas valide. Reviens à l'étape précédente."); }
  const parsed = companyOnboardingSchema.safeParse(raw);
  if (!parsed.success) {
    return invalidState(parsed.error.issues[0]?.message || "Vérifie les informations de l'entreprise.");
  }
  const input = parsed.data;
  const { supabase } = await requireUser();
  const selected = resolveLocality(input.localityRef, input.regionCode);
  const exactMatch = selected && selected.name.toLocaleLowerCase("fr") === input.localityName.toLocaleLowerCase("fr");
  const payload = {
    ...input,
    // Do not fabricate a district/commune for a user-entered village.
    localityRef: exactMatch ? selected.ref : "",
    communeName: exactMatch ? selected.commune : "",
    districtName: exactMatch ? selected.district : "",
    fiscalProfileConfirmed: false,
  };
  const { data, error } = await supabase.rpc("magnisa_create_onboarded_company", { p_payload: payload });
  if (error || typeof data !== "string") {
    console.error("[company-onboarding] creation failed", error?.code || "invalid_return");
    return invalidState("La création de l'entreprise n'a pas abouti. Vérifie les données et réessaie.");
  }
  const cookieStore = await cookies();
  cookieStore.set("magnisa_active_org", data, { httpOnly:true, sameSite:"lax", secure:process.env.NODE_ENV==="production", path:"/" });
  revalidatePath("/choisir-organisation");
  revalidatePath("/parametres");
  revalidatePath("/", "layout");
  return { error:null, organizationId:data };
}

const COLOR = /^#[0-9A-Fa-f]{6}$/;
const filePath = (org: string, role: "color" | "inverse", path: string) =>
  new RegExp(`^${org.replace(/-/g,"\\-")}/${role}-[a-f0-9-]{36}\\.(png|jpg|webp)$`).test(path);

export async function saveCompanyOnboardingBranding(args: {
  organizationId: string;
  colorPath?: string;
  inversePath?: string;
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
}): Promise<{ error: string | null }> {
  const { supabase, user } = await requireUser();
  const id = args.organizationId;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error:"Entreprise invalide." };
  const { data: member, error: memberError } = await supabase.from("organization_members")
    .select("role,status").eq("organization_id",id).eq("user_id",user.id).maybeSingle();
  if (memberError || !member || member.status !== "active" || !["owner","admin"].includes(member.role)) {
    return {error:"Seul un administrateur peut importer les logos."};
  }
  const colorPath = args.colorPath || "";
  const inversePath = args.inversePath || "";
  if ((colorPath && !filePath(id,"color",colorPath)) ||
      (inversePath && !filePath(id,"inverse",inversePath))) {
    return {error:"Chemin du logo invalide."};
  }
  if (!colorPath && !inversePath) return {error:null};

  const bucket = supabase.storage.from("organization-branding");
  for (const path of [colorPath,inversePath].filter(Boolean)) {
    const [folder,file] = path.split("/");
    const { data: entries, error } = await bucket.list(folder, { search:file, limit:20 });
    if (error || !entries?.some(item => item.name === file)) {
      return {error:"Logo introuvable dans le stockage sécurisé."};
    }
  }
  const payload: Record<string,unknown> = {};
  if (colorPath) payload.logo_storage_path = colorPath;
  if (inversePath) payload.logo_inverse_storage_path = inversePath;
  const palette = {
    primaryColor: colorPath && args.primaryColor && COLOR.test(args.primaryColor) ? args.primaryColor : null,
    secondaryColor: colorPath && args.secondaryColor && COLOR.test(args.secondaryColor) ? args.secondaryColor : null,
    accentColor: colorPath && args.accentColor && COLOR.test(args.accentColor) ? args.accentColor : null,
  };
  if (palette.primaryColor) payload.primary_color=palette.primaryColor;
  if (palette.secondaryColor) payload.secondary_color=palette.secondaryColor;
  if (palette.accentColor) payload.accent_color=palette.accentColor;
  if (Object.values(palette).some(Boolean)) {
    const {data:existing,error:readError}=await supabase.from("company_settings")
      .select("document_theme").eq("organization_id",id).single();
    if(readError)return {error:"Impossible de lire la charte documentaire actuelle."};
    const current=existing?.document_theme && typeof existing.document_theme==="object" &&
      !Array.isArray(existing.document_theme) ? existing.document_theme : {};
    payload.document_theme={
      ...current,
      ...(palette.primaryColor ? {primaryColor:palette.primaryColor} : {}),
      ...(palette.secondaryColor ? {secondaryColor:palette.secondaryColor} : {}),
      ...(palette.accentColor ? {accentColor:palette.accentColor} : {}),
    };
  }

  const { data, error } = await supabase.from("company_settings")
    .update(payload).eq("organization_id",id).select("organization_id").single();
  if (error || !data) return {error:"Impossible d'associer les logos à l'entreprise."};
  revalidatePath("/parametres");
  revalidatePath("/identite-documents");
  revalidatePath("/modeles-documents");
  return {error:null};
}
