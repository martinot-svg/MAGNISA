import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireOrganization } from "@/lib/current-org";
import { assertPermission, hasPermission } from "@/lib/permissions";
import { FormDialog } from "@/components/form-dialog";
import { internalMailboxLabel, normalizeMGMailLocalPart, normalizeMGMailNamespace } from "@/lib/magnimail/internal-address";

const PATH = "/magnimail/interne";

async function createNamespace(form: FormData) {
  "use server";
  const ctx = await requireOrganization();
  await assertPermission(ctx, "users.manage");
  const slug = normalizeMGMailNamespace(String(form.get("slug") || ""));
  const { error } = await ctx.supabase.from("mgmail_internal_namespaces").insert({
    organization_id: ctx.organizationId,
    slug,
  });
  if (error) throw new Error("Identifiant déjà utilisé ou configuration impossible.");
  revalidatePath(PATH);
  revalidatePath("/orbit/inbox");
  revalidatePath("/orbit/magnibox");
  revalidatePath("/magnimail");
}

async function createMailbox(form: FormData) {
  "use server";
  const ctx = await requireOrganization();
  await assertPermission(ctx, "users.manage");
  const localPart = normalizeMGMailLocalPart(String(form.get("localPart") || ""));
  const ownerId = String(form.get("ownerId") || "").trim();
  const displayName = String(form.get("displayName") || "").trim().slice(0, 120);
   if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(ownerId)) {
    throw new Error("Collaborateur invalide.");
  }
  const { data: member, error: memberError } = await ctx.supabase
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", ctx.organizationId)
    .eq("user_id", ownerId)
    .eq("status", "active")
    .maybeSingle();
  if (memberError || !member) throw new Error("Le destinataire doit être un collaborateur actif.");
  const { error } = await ctx.supabase.from("mgmail_internal_mailboxes").insert({
    organization_id: ctx.organizationId,
    local_part: localPart,
    owner_user_id: ownerId,
    display_name: displayName,
  });
  if (error) throw new Error("Cette adresse existe déjà ou ne peut pas être attribuée.");
  revalidatePath(PATH);
  revalidatePath("/orbit/inbox");
  revalidatePath("/orbit/magnibox");
  revalidatePath("/magnimail");
}

async function setMailboxPermissions(form: FormData) {
  "use server";
  const ctx = await requireOrganization();
  await assertPermission(ctx, "users.manage");
  const id = String(form.get("mailboxId") || "");
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(id)) throw new Error("Boîte invalide.");
  const { error } = await ctx.supabase
    .from("mgmail_internal_mailboxes")
    .update({
      can_read: form.get("canRead") === "on",
      can_send: form.get("canSend") === "on",
      is_active: form.get("isActive") === "on",
    })
    .eq("id", id)
    .eq("organization_id", ctx.organizationId);
  if (error) throw new Error("Impossible de modifier les droits de cette boîte.");
  revalidatePath(PATH);
  revalidatePath("/orbit/inbox");
  revalidatePath("/orbit/magnibox");
  revalidatePath("/magnimail");
}

async function shareMailbox(form: FormData) {
  "use server";
  const ctx = await requireOrganization();
  await assertPermission(ctx, "users.manage");
  const mailboxId = String(form.get("mailboxId") || "");
  const userId = String(form.get("userId") || "");
  const uuid = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i;
  if (!uuid.test(mailboxId) || !uuid.test(userId)) {
    throw new Error("Boîte ou collaborateur invalide.");
  }
  const [mailboxResult, memberResult] = await Promise.all([
    ctx.supabase.from("mgmail_internal_mailboxes").select("id")
      .eq("id", mailboxId).eq("organization_id", ctx.organizationId).maybeSingle(),
    ctx.supabase.from("organization_members").select("user_id")
      .eq("organization_id", ctx.organizationId).eq("user_id", userId)
      .eq("status", "active").maybeSingle(),
  ]);
  if (!mailboxResult.data || !memberResult.data || mailboxResult.error || memberResult.error) {
    throw new Error("Boîte ou collaborateur indisponible pour cette entreprise.");
  }
  const canRead = form.get("canRead") === "on";
  const canSend = form.get("canSend") === "on";
  const active = canRead || canSend;
  const query = ctx.supabase.from("mgmail_internal_mailbox_grants");
  const { data: existing, error: lookupError } = await query.select("mailbox_id")
    .eq("organization_id", ctx.organizationId)
    .eq("mailbox_id", mailboxId).eq("user_id", userId).maybeSingle();
  if (lookupError) throw new Error("Impossible de vérifier la délégation de boîte.");
  const values = {
    can_read: canRead, can_send: canSend,
    is_active: active,
  };
  const result = existing
    ? await ctx.supabase.from("mgmail_internal_mailbox_grants")
        .update(values).eq("organization_id", ctx.organizationId)
        .eq("mailbox_id", mailboxId).eq("user_id", userId)
    : await ctx.supabase.from("mgmail_internal_mailbox_grants")
        .insert({ organization_id: ctx.organizationId, mailbox_id: mailboxId, user_id: userId, ...values });
  if (result.error) throw new Error("Impossible d'enregistrer les autorisations partagées.");
  revalidatePath(PATH);
  revalidatePath("/orbit/inbox");
  revalidatePath("/orbit/magnibox");
  revalidatePath("/magnimail");
}

async function saveInternalDraft(form: FormData) {
  "use server";
  const ctx = await requireOrganization();
  const draftId = String(form.get("draftId") || "").trim();
  let senderId = String(form.get("senderId") || "").trim();
  const recipientId = String(form.get("recipientId") || "").trim();
  const subject = String(form.get("subject") || "");
  const body = String(form.get("body") || "");
  const uuid = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i;
  if (!uuid.test(senderId) || (draftId && !uuid.test(draftId))
    || subject.length > 180 || body.length > 50000) {
    throw new Error("Brouillon invalide.");
  }
  if (draftId) {
    const { data: existing, error } = await ctx.supabase.from("mgmail_internal_drafts")
      .select("sender_mailbox_id").eq("id", draftId).eq("organization_id", ctx.organizationId).maybeSingle();
    if (error || !existing) throw new Error("Brouillon introuvable ou accès révoqué.");
    senderId = existing.sender_mailbox_id;
  }
  const { data: canSend, error: permissionError } = await ctx.supabase.rpc("mgmail_has_internal_access", {
    p_org: ctx.organizationId, p_mailbox: senderId, p_action: "send",
  });
  if (permissionError || canSend !== true) throw new Error("Vous ne pouvez plus enregistrer depuis cette boîte.");
  if (recipientId) {
    const { data: canAddress, error: recipientError } = await ctx.supabase.rpc("mgmail_can_send_internal", {
      p_organization_id: ctx.organizationId,
      p_sender_mailbox_id: senderId,
      p_recipient_mailbox_id: recipientId,
    });
    if (recipientError || canAddress !== true) throw new Error("La boîte destinataire est indisponible.");
  }
  const values = { recipient_mailbox_id: recipientId || null, subject, body_text: body };
  const result = draftId
    ? await ctx.supabase.from("mgmail_internal_drafts").update(values)
        .eq("id", draftId).eq("organization_id", ctx.organizationId)
        .select("id,subject,body_text").maybeSingle()
    : await ctx.supabase.from("mgmail_internal_drafts").insert({
        organization_id: ctx.organizationId, sender_mailbox_id: senderId, ...values,
      }).select("id,subject,body_text").single();
  if (result.error || !result.data
    || result.data.subject !== subject || result.data.body_text !== body) {
    throw new Error("Le brouillon n'a pas été enregistré. Vérifie les droits et réessaie.");
  }
  revalidatePath(PATH);
  revalidatePath("/orbit/inbox");
  revalidatePath("/orbit/magnibox");
  revalidatePath("/magnimail");
}

async function deleteInternalDraft(form: FormData) {
  "use server";
  const ctx = await requireOrganization();
  const draftId = String(form.get("draftId") || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(draftId)) throw new Error("Brouillon invalide.");
  const { data: deleted, error } = await ctx.supabase.from("mgmail_internal_drafts")
    .delete().eq("id", draftId).eq("organization_id", ctx.organizationId).select("id").maybeSingle();
  if (error || !deleted) throw new Error("Brouillon introuvable ou suppression non autorisée.");
  revalidatePath(PATH);
  revalidatePath("/orbit/inbox");
  revalidatePath("/orbit/magnibox");
  revalidatePath("/magnimail");
}

async function sendInternal(form: FormData) {
  "use server";
  const ctx = await requireOrganization();
  const draftId = String(form.get("draftId") || "").trim();
  if (draftId) {
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(draftId)) throw new Error("Brouillon invalide.");
    const { data: sent, error } = await ctx.supabase.rpc("mgmail_send_internal_draft", { p_draft_id: draftId });
    if (error || sent !== true) throw new Error("Le brouillon ne peut pas être envoyé : vérifiez ses champs et les droits des boîtes.");
    revalidatePath(PATH);
    revalidatePath("/orbit/inbox");
    revalidatePath("/orbit/magnibox");
    revalidatePath("/magnimail");
    return;
  }
  const senderId = String(form.get("senderId") || "").trim();
  const recipientId = String(form.get("recipientId") || "").trim();
  const requestId = String(form.get("requestId") || "").trim();
  const subject = String(form.get("subject") || "").trim();
  const body = String(form.get("body") || "").trim();
  const uuid = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i;
  if (!uuid.test(senderId) || !uuid.test(recipientId) || !uuid.test(requestId)
    || !subject || subject.length > 180 || !body || body.length > 50000) {
    throw new Error("Objet, contenu ou identifiant de requête invalide.");
  }

  // The database enforces permissions and idempotency in one transaction.
  // A browser retry with the same requestId resolves to the original message.
  const { data: messageId, error } = await ctx.supabase.rpc("mgmail_send_internal_message", {
    p_organization_id: ctx.organizationId,
    p_sender_mailbox_id: senderId,
    p_recipient_mailbox_id: recipientId,
    p_subject: subject,
    p_body_text: body,
    p_request_id: requestId,
  });
  if (error || !messageId) {
    throw new Error("Envoi interne impossible : permissions ou boîte indisponible.");
  }
  revalidatePath(PATH);
  revalidatePath("/orbit/inbox");
  revalidatePath("/orbit/magnibox");
  revalidatePath("/magnimail");
}

async function markInternalRead(form: FormData) {
  "use server";
  const ctx = await requireOrganization();
  const messageId = String(form.get("messageId") || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(messageId)) {
    throw new Error("Message invalide.");
  }
  const { data: message, error: messageError } = await ctx.supabase
    .from("mgmail_internal_messages")
    .select("id,recipient_mailbox_id")
    .eq("id", messageId).eq("organization_id", ctx.organizationId)
    .maybeSingle();
  if (messageError || !message) throw new Error("Message indisponible.");
  const { data: allowed, error: accessError } = await ctx.supabase
    .rpc("mgmail_has_internal_access", {
      p_org: ctx.organizationId,
      p_mailbox: message.recipient_mailbox_id,
      p_action: "read",
    });
  if (accessError || allowed !== true) throw new Error("Lecture non autorisée.");
  const { data: alreadyRead, error: checkError } = await ctx.supabase
    .from("mgmail_internal_message_reads").select("message_id")
    .eq("message_id", messageId).eq("user_id", ctx.user.id).maybeSingle();
  if (checkError) throw new Error("Impossible de vérifier la lecture.");
  if (!alreadyRead) {
    const { error } = await ctx.supabase.from("mgmail_internal_message_reads").insert({
      organization_id: ctx.organizationId,
      message_id: messageId,
      user_id: ctx.user.id,
    });
    if (error && error.code !== "23505") throw new Error("Impossible de marquer le message comme lu.");
  }
  revalidatePath(PATH);
  revalidatePath("/orbit/inbox");
  revalidatePath("/orbit/magnibox");
  revalidatePath("/magnimail");
}

/** Shared internal mail capability, embedded in the single Magnibox workspace. */
export async function MagniboxInternalContent({ embedded = false, searchQuery = "" }: { embedded?: boolean; searchQuery?: string } = {}) {
  const ctx = await requireOrganization();
  const searchTerm = String(searchQuery).replace(/[^\p{L}\p{N}\s-]/gu, "").trim().slice(0, 80);
  const searchAction = embedded ? "/orbit/magnibox" : PATH;
  const canManage = await hasPermission(ctx, "users.manage");
  let messagesQuery = ctx.supabase.from("mgmail_internal_messages")
    .select("id,sender_mailbox_id,recipient_mailbox_id,subject,body_text,created_at")
    .eq("organization_id", ctx.organizationId)
    .order("created_at", { ascending: false }).limit(80);
  let draftsQuery = ctx.supabase.from("mgmail_internal_drafts")
    .select("id,sender_mailbox_id,recipient_mailbox_id,subject,body_text,updated_at")
    .eq("organization_id", ctx.organizationId).order("updated_at", { ascending: false }).limit(50);
  if (searchTerm) {
    const pattern = "%" + searchTerm + "%";
    messagesQuery = messagesQuery.or("subject.ilike." + pattern + ",body_text.ilike." + pattern);
    draftsQuery = draftsQuery.or("subject.ilike." + pattern + ",body_text.ilike." + pattern);
  }
  const [namespaceResult, mailboxesResult, messagesResult, grantsResult, readsResult, draftsResult] = await Promise.all([
    ctx.supabase.from("mgmail_internal_namespaces")
      .select("slug").eq("organization_id", ctx.organizationId).maybeSingle(),
    ctx.supabase.from("mgmail_internal_mailboxes")
      .select("id,local_part,owner_user_id,display_name,is_active,can_read,can_send")
      .eq("organization_id", ctx.organizationId).order("local_part"),
    messagesQuery,
    ctx.supabase.from("mgmail_internal_mailbox_grants")
      .select("mailbox_id,user_id,can_read,can_send,is_active")
      .eq("organization_id", ctx.organizationId),
    ctx.supabase.from("mgmail_internal_message_reads")
      .select("message_id").eq("organization_id", ctx.organizationId).eq("user_id", ctx.user.id),
    draftsQuery,
  ]);
  const namespace = namespaceResult.data?.slug || "";
  const mailboxes = mailboxesResult.data || [];
  const messages = messagesResult.data || [];
  const grants = grantsResult.data || [];
  const drafts = draftsResult.data || [];
  const myGrants = grants.filter((grant) => grant.user_id === ctx.user.id && grant.is_active);
  const canUseMailbox = (mailbox: (typeof mailboxes)[number], action: "read" | "send") =>
    mailbox.is_active && (
      (mailbox.owner_user_id === ctx.user.id &&
        (action === "read" ? mailbox.can_read : mailbox.can_send))
      || myGrants.some((grant) => grant.mailbox_id === mailbox.id &&
        (action === "read" ? grant.can_read : grant.can_send))
    );
  const mine = mailboxes.filter((mailbox) => canUseMailbox(mailbox, "send"));
  const readIds = new Set((readsResult.data || []).map((read) => read.message_id));
  const directory = canManage
    ? await ctx.supabase.rpc("organization_member_directory", { p_org: ctx.organizationId })
    : null;
  const members = (directory?.data || []).filter((member: { status: string }) => member.status === "active");
  const mailboxById = new Map(mailboxes.map((mailbox) => [mailbox.id, mailbox]));
  const address = (id: string) => {
    const mailbox = mailboxById.get(id);
    return mailbox ? internalMailboxLabel(mailbox.local_part, namespace) : "Boîte inconnue";
  };
  const readableMailboxIds = new Set(
    mailboxes.filter((mailbox) => canUseMailbox(mailbox, "read")).map((mailbox) => mailbox.id),
  );
  const inbox = messages.filter((message) => readableMailboxIds.has(message.recipient_mailbox_id));
  const sent = messages.filter((message) => readableMailboxIds.has(message.sender_mailbox_id));
  const unreadCount = inbox.filter((message) => !readIds.has(message.id)).length;
  const renderMessages = (items: typeof messages, kind: "inbox" | "sent") => items.length === 0 ? (
    <p className="muted">{searchTerm ? "Aucun message ne correspond à la recherche." : "Aucun message dans cette boîte."}</p>
  ) : (
    <div>
      {items.map((message) => (
        <div key={message.id} style={{ borderBottom: "1px solid #e5e7eb", padding: "14px 0" }}>
          <strong>{message.subject}</strong>
          {kind === "inbox" && !readIds.has(message.id) && (
            <span className="badge" style={{ marginLeft: 10 }}>Non lu</span>
          )}
          <p className="muted">
            De : {address(message.sender_mailbox_id)} · À : {address(message.recipient_mailbox_id)}
            {" · "}{new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(new Date(message.created_at))}
          </p>
          <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{message.body_text}</p>
          {kind === "inbox" && mine.length > 0 && mailboxById.get(message.sender_mailbox_id)?.is_active && (
            <FormDialog title={`Répondre : ${message.subject}`} buttonLabel="Répondre" buttonClassName="button">
              <form action={sendInternal} className="form">
              <input type="hidden" name="requestId" value={crypto.randomUUID()} />
                <input type="hidden" name="senderId" value={(mine.find((mailbox) => mailbox.id === message.recipient_mailbox_id) ?? mine[0]).id} />
                <input type="hidden" name="recipientId" value={message.sender_mailbox_id} />
                <div className="field">
                  <label>Objet</label>
                  <input name="subject" maxLength={180} defaultValue={`Re : ${message.subject}`.slice(0, 180)} required />
                </div>
                <div className="field">
                  <label>Votre réponse</label>
                  <textarea name="body" rows={8} maxLength={50000}
                    defaultValue={`\n\n--- Message d'origine ---\nDe : ${address(message.sender_mailbox_id)}\nÀ : ${address(message.recipient_mailbox_id)}\n\n${message.body_text.slice(0, 35000)}`} required />
                </div>
                <button className="button primary" type="submit">Envoyer la réponse</button>
              </form>
            </FormDialog>
          )}
          {mine.length > 0 && (
            <FormDialog title={`Transférer : ${message.subject}`} buttonLabel="Transférer" buttonClassName="button">
              <form action={sendInternal} className="form">
              <input type="hidden" name="requestId" value={crypto.randomUUID()} />
                <div className="field">
                  <label>Expéditeur</label>
                  <select name="senderId" required defaultValue={mine[0].id}>
                    {mine.map((mailbox) => (
                      <option key={mailbox.id} value={mailbox.id}>{address(mailbox.id)}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Destinataire</label>
                  <select name="recipientId" required defaultValue="">
                    <option value="" disabled>Choisir une boîte active</option>
                    {mailboxes.filter((mailbox) => mailbox.is_active).map((mailbox) => (
                      <option key={mailbox.id} value={mailbox.id}>{address(mailbox.id)}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Objet</label>
                  <input name="subject" maxLength={180} defaultValue={`Tr : ${message.subject}`.slice(0, 180)} required />
                </div>
                <div className="field">
                  <label>Message transféré (modifiable)</label>
                  <textarea name="body" rows={8} maxLength={50000}
                    defaultValue={`--- Message transféré ---\nDe : ${address(message.sender_mailbox_id)}\nÀ : ${address(message.recipient_mailbox_id)}\n\n${message.body_text.slice(0, 35000)}`} required />
                </div>
                <button className="button primary" type="submit">Transférer le message</button>
              </form>
            </FormDialog>
          )}
          {kind === "inbox" && !readIds.has(message.id) && (
            <FormDialog title="Confirmer la lecture du message" buttonLabel="Marquer comme lu" buttonClassName="button">
              <form action={markInternalRead} className="form">
                <input type="hidden" name="messageId" value={message.id} />
                <p>Confirmer la lecture de ce message dans Magnibox.</p>
                <button className="button primary" type="submit">Confirmer</button>
              </form>
            </FormDialog>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <>
      {!embedded && (
        <>
          <div className="pageHead">
            <div>
              <p className="eyebrow">Magnisa Orbit · Magnibox</p>
              <h1>Magnibox</h1>
              <p>Messages, boîtes et collaborateurs de l'entreprise.</p>
            </div>
            <Link className="button" href="/orbit/magnibox">Retour à la messagerie</Link>
          </div>
          <div className="card section">
            <p className="muted">
              Les collaborateurs échangent directement dans MAGNISA, sans adresse Internet.
              Les adresses Internet personnalisées deviennent disponibles après vérification
              du domaine et activation d'un véritable transport.
            </p>
          </div>
        </>
      )}
      {namespaceResult.error || mailboxesResult.error || messagesResult.error || grantsResult.error || readsResult.error ? (
        <div className="card section" role="alert">
          Impossible de charger les boîtes Magnibox. La migration interne et les permissions
          doivent être validées avant utilisation.
        </div>
      ) : !namespace ? (
        <div className="card section">
          <h2>Configurer l'espace de messagerie de l'entreprise</h2>
          {canManage ? (
            <FormDialog title="Créer l'identifiant interne de l'entreprise" buttonLabel="Configurer la messagerie interne">
              <form action={createNamespace} className="form">
                <div className="field">
                  <label htmlFor="mgmail-namespace">Identifiant de l'entreprise pour les boîtes internes</label>
                  <input id="mgmail-namespace" name="slug" minLength={2} maxLength={45}
                    placeholder="mitalia" pattern="[a-z0-9]+(-[a-z0-9]+)*" required />
                  <small>Exemple de boîte interne : finance (mitalia). Ce libellé n'est pas une adresse Internet.</small>
                </div>
                <button className="button primary">Créer cet espace</button>
              </form>
            </FormDialog>
          ) : <p className="muted">Un administrateur doit configurer l’espace de messagerie interne.</p>}
        </div>
      ) : (
        <>
          {canManage && (
            <div className="card section">
              <FormDialog title="Créer une boîte interne pour un collaborateur" buttonLabel="+ Créer une boîte">
                <form action={createMailbox} className="form">
                  <div className="field">
                    <label>Nom de la boîte</label>
                    <input name="localPart" placeholder="finance" minLength={2} maxLength={64} required />
                  </div>
                  <div className="field">
                    <label>Nom affiché</label>
                    <input name="displayName" placeholder="Service finance" maxLength={120} />
                  </div>
                  <div className="field">
                    <label>Collaborateur</label>
                    <select name="ownerId" required>
                      <option value="">Choisir un collaborateur</option>
                      {members.map((member: { user_id: string; email: string }) => (
                        <option key={member.user_id} value={member.user_id}>{member.email}</option>
                      ))}
                    </select>
                  </div>
                  <button className="button primary">Créer et attribuer la boîte</button>
                </form>
              </FormDialog>
              <div className="tableWrap">
                <table>
                  <thead><tr><th>Boîte interne</th><th>Lecture</th><th>Envoi</th><th>État</th><th>Gestion</th></tr></thead>
                  <tbody>
                    {mailboxes.map((mailbox) => (
                      <tr key={mailbox.id}>
                        <td>{address(mailbox.id)}</td>
                        <td>{mailbox.can_read ? "Autorisé" : "Interdit"}</td>
                        <td>{mailbox.can_send ? "Autorisé" : "Interdit"}</td>
                        <td>{mailbox.is_active ? "Active" : "Suspendue"}</td>
                        <td>
                          <FormDialog title={`Partager : ${address(mailbox.id)}`} buttonLabel="Partager la boîte" buttonClassName="button">
                            <form action={shareMailbox} className="form">
                              <input type="hidden" name="mailboxId" value={mailbox.id} />
                              <div className="field">
                                <label>Collaborateur autorisé</label>
                                <select name="userId" required>
                                  <option value="">Choisir un collaborateur</option>
                                  {members.map((member: { user_id: string; email: string }) => (
                                    <option key={member.user_id} value={member.user_id}>{member.email}</option>
                                  ))}
                                </select>
                              </div>
                              <p className="muted">
                                {grants.filter((grant) => grant.mailbox_id === mailbox.id && grant.is_active).length}
                                {" "}collaborateur(s) délégué(s) actif(s).
                                Pour retirer l'accès d'une personne, décochez lecture et envoi.
                              </p>
                              <label><input type="checkbox" name="canRead" defaultChecked /> Autoriser la lecture</label>
                              <label><input type="checkbox" name="canSend" /> Autoriser les envois</label>
                              <button className="button primary" type="submit">Enregistrer le partage</button>
                            </form>
                          </FormDialog>
                          <FormDialog title={`Autorisations : ${address(mailbox.id)}`} buttonLabel="Modifier les droits" buttonClassName="button">
                            <form action={setMailboxPermissions} className="form">
                              <input type="hidden" name="mailboxId" value={mailbox.id} />
                              <label><input type="checkbox" name="canRead" defaultChecked={mailbox.can_read} /> Autoriser la lecture</label>
                              <label><input type="checkbox" name="canSend" defaultChecked={mailbox.can_send} /> Autoriser les envois internes</label>
                              <label><input type="checkbox" name="isActive" defaultChecked={mailbox.is_active} /> Boîte active</label>
                              <button className="button primary">Enregistrer les droits</button>
                            </form>
                          </FormDialog>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <div className="card section">
            <h2>Messages internes</h2>
            <form method="get" action={searchAction} className="form" style={{ marginBottom: 16 }}>
              <div className="field">
                <label htmlFor="magnibox-internal-search">Rechercher dans les messages et brouillons</label>
                <input id="magnibox-internal-search" type="search" name="q" maxLength={80}
                  defaultValue={searchTerm} placeholder="Objet ou contenu du message" />
              </div>
              <div className="row" style={{ gap: 8, alignItems: "center" }}>
                <button className="button primary" type="submit">Rechercher</button>
                {searchTerm && <a className="button" href={searchAction}>Effacer</a>}
              </div>
            </form>
            {searchTerm && <p className="muted">Recherche « {searchTerm} » : {messages.length} message(s), {drafts.length} brouillon(s).</p>}
            {mine.length > 0 && (
              <FormDialog title="Nouveau message interne" buttonLabel="+ Nouveau message">
                <form action={sendInternal} className="form">
              <input type="hidden" name="requestId" value={crypto.randomUUID()} />
                  <div className="field">
                    <label>Expéditeur</label>
                    <select name="senderId" required>
                      {mine.map((mailbox) => (
                        <option key={mailbox.id} value={mailbox.id}>{address(mailbox.id)}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>Destinataire dans l'entreprise</label>
                    <select name="recipientId" required>
                      <option value="">Choisir une boîte active</option>
                      {mailboxes.filter((mailbox) => mailbox.is_active).map((mailbox) => (
                        <option key={mailbox.id} value={mailbox.id}>{address(mailbox.id)}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field"><label>Objet</label><input name="subject" maxLength={180} required /></div>
                  <div className="field"><label>Message</label><textarea name="body" maxLength={50000} rows={8} required /></div>
                  <button className="button primary">Envoyer dans MAGNISA</button>
                  <button className="button" formAction={saveInternalDraft} formNoValidate>Enregistrer le brouillon</button>
                </form>
              </FormDialog>
            )}
            {mine.length === 0 && <p className="muted">Aucune boîte active autorisée à envoyer ne vous est attribuée.</p>}
            <h3>Brouillons ({drafts.length})</h3>
            {drafts.length === 0 ? <p className="muted">{searchTerm ? "Aucun brouillon ne correspond à la recherche." : "Aucun brouillon enregistré."}</p> : (
              <div>
                {drafts.map((draft) => (
                  <div key={draft.id} data-testid="magnibox-internal-draft" style={{ borderBottom: "1px solid #e5e7eb", padding: "10px 0" }}>
                    <strong>{draft.subject || "(Sans objet)"}</strong>
                    <p className="muted">Modifié le {new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(new Date(draft.updated_at))}</p>
                    <FormDialog title="Modifier le brouillon" buttonLabel="Ouvrir" buttonClassName="button">
                      <form action={sendInternal} className="form">
              <input type="hidden" name="requestId" value={crypto.randomUUID()} />
                        <input type="hidden" name="draftId" value={draft.id} />
                        <input type="hidden" name="senderId" value={draft.sender_mailbox_id} />
                        <p className="muted">Expéditeur : {address(draft.sender_mailbox_id)}</p>
                        <div className="field">
                          <label>Destinataire dans l'entreprise</label>
                          <select name="recipientId" defaultValue={draft.recipient_mailbox_id || ""}>
                            <option value="">Choisir une boîte active</option>
                            {mailboxes.filter((mailbox) => mailbox.is_active).map((mailbox) => (
                              <option key={mailbox.id} value={mailbox.id}>{address(mailbox.id)}</option>
                            ))}
                          </select>
                        </div>
                        <div className="field"><label>Objet</label><input name="subject" maxLength={180} defaultValue={draft.subject} /></div>
                        <div className="field"><label>Message</label><textarea name="body" maxLength={50000} rows={8} defaultValue={draft.body_text} /></div>
                        <button className="button primary" type="submit">Envoyer dans MAGNISA</button>
                        <button className="button" formAction={saveInternalDraft} formNoValidate>Enregistrer les modifications</button>
                      </form>
                    </FormDialog>
                    <form action={deleteInternalDraft} className="form">
                      <input type="hidden" name="draftId" value={draft.id} />
                      <button className="button" type="submit">Supprimer le brouillon</button>
                    </form>
                  </div>
                ))}
              </div>
            )}
            <h3>Boîte de réception interne ({unreadCount} non lus affichés)</h3>
            {renderMessages(inbox, "inbox")}
            <h3>Envoyés internes</h3>
            {renderMessages(sent, "sent")}

          </div>
        </>
      )}
    </>
  );
}

/** Backward-compatible export for historical internal routes; the product is Magnibox. */
export const MGMailInternalContent = MagniboxInternalContent;
