import { revalidatePath } from "next/cache";
import { requireOrganization } from "@/lib/current-org";
import { assertPermission } from "@/lib/permissions";
import { normalizeMGMailDomain, publicAddressDomain } from "./domain-verification";
import { normalizeInternetAddress } from "./internet-resend";

const PATH = "/magnimail/externe";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function requestMGMailPublicDomain(form: FormData) {
  "use server";
  const ctx = await requireOrganization();
  await assertPermission(ctx, "users.manage");
  const domain = normalizeMGMailDomain(String(form.get("domain") || ""));
  const { error } = await ctx.supabase.from("mgmail_domain_requests").insert({
    organization_id: ctx.organizationId,
    requested_by: ctx.user.id,
    domain_name: domain,
  });
  if (error && error.code !== "23505") {
    throw new Error("Impossible d'enregistrer la demande de vérification du domaine.");
  }
  revalidatePath(PATH);
}

export async function requestMGMailPublicAddress(form: FormData) {
  "use server";
  const ctx = await requireOrganization();
  await assertPermission(ctx, "users.manage");
  const mailboxId = String(form.get("mailboxId") || "");
  const address = normalizeInternetAddress(String(form.get("address") || ""));
  const domain = publicAddressDomain(address);
  if (!UUID.test(mailboxId)) throw new Error("Boîte MGMail invalide.");
  const [mailbox, requestedDomain] = await Promise.all([
    ctx.supabase.from("mgmail_internal_mailboxes")
      .select("id").eq("organization_id", ctx.organizationId)
      .eq("id", mailboxId).maybeSingle(),
    ctx.supabase.from("mgmail_domain_requests")
      .select("id").eq("organization_id", ctx.organizationId)
      .eq("domain_name", domain).in("status", ["pending","approved"])
      .maybeSingle(),
  ]);
  if (mailbox.error || !mailbox.data || requestedDomain.error || !requestedDomain.data) {
    throw new Error("Domaine non demandé ou boîte non autorisée pour cette entreprise.");
  }
  const { error } = await ctx.supabase.from("mgmail_public_address_requests").insert({
    organization_id: ctx.organizationId,
    mailbox_id: mailboxId,
    email_address: address,
    requested_by: ctx.user.id,
  });
  if (error && error.code !== "23505") {
    throw new Error("Impossible d'enregistrer la demande d'adresse professionnelle.");
  }
  revalidatePath(PATH);
}
