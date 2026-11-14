import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireOrganization } from "@/lib/current-org";
import { assertPermission, hasPermission } from "@/lib/permissions";
import { FormDialog } from "@/components/form-dialog";
import { internalMGMailAddress, normalizeMGMailLocalPart, normalizeMGMailNamespace } from "@/lib/magnimail/internal-address";

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

async function sendInternal(form: FormData) {
  "use server";
  const ctx = await requireOrganization();
  const senderId = String(form.get("senderId") || "");
  const recipientId = String(form.get("recipientId") || "");
  const subject = String(form.get("subject") || "").trim();
  const body = String(form.get("body") || "").trim();
  if (!subject || subject.length > 180 || !body || body.length > 50000) {
    throw new Error("Objet ou contenu du message invalide.");
  }

  const { data: allowed, error: permissionError } = await ctx.supabase
    .rpc("mgmail_can_send_internal", {
      p_organization_id: ctx.organizationId,
      p_sender_mailbox_id: senderId,
      p_recipient_mailbox_id: recipientId,
    });
  if (permissionError || allowed !== true) {
    throw new Error("Vous n'êtes pas autorisé à envoyer depuis cette boîte ou vers ce destinataire.");
  }

  const { error } = await ctx.supabase.from("mgmail_internal_messages").insert({
    organization_id: ctx.organizationId,
    sender_mailbox_id: senderId,
    recipient_mailbox_id: recipientId,
    subject,
    body_text: body,
  });
  if (error) throw new Error("Envoi interne impossible : permissions ou boîte indisponible.");
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
export async function MGMailInternalContent({ embedded = false }: { embedded?: boolean } = {}) {
  const ctx = await requireOrganization();
  const canManage = await hasPermission(ctx, "users.manage");
  const [namespaceResult, mailboxesResult, messagesResult, grantsResult, readsResult] = await Promise.all([
    ctx.supabase.from("mgmail_internal_namespaces")
      .select("slug").eq("organization_id", ctx.organizationId).maybeSingle(),
    ctx.supabase.from("mgmail_internal_mailboxes")
      .select("id,local_part,owner_user_id,display_name,is_active,can_read,can_send")
      .eq("organization_id", ctx.organizationId).order("local_part"),
    ctx.supabase.from("mgmail_internal_messages")
      .select("id,sender_mailbox_id,recipient_mailbox_id,subject,body_text,created_at")
      .eq("organization_id", ctx.organizationId)
      .order("created_at", { ascending: false }).limit(80),
    ctx.supabase.from("mgmail_internal_mailbox_grants")
      .select("mailbox_id,user_id,can_read,can_send,is_active")
      .eq("organization_id", ctx.organizationId),
    ctx.supabase.from("mgmail_internal_message_reads")
      .select("message_id").eq("organization_id", ctx.organizationId).eq("user_id", ctx.user.id),
  ]);
  const namespace = namespaceResult.data?.slug || "";
  const mailboxes = mailboxesResult.data || [];
  const messages = messagesResult.data || [];
  const grants = grantsResult.data || [];
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
    return mailbox ? internalMGMailAddress(mailbox.local_part, namespace) : "Boîte inconnue";
  };
  const readableMailboxIds = new Set(
    mailboxes.filter((mailbox) => canUseMailbox(mailbox, "read")).map((mailbox) => mailbox.id),
  );
  const inbox = messages.filter((message) => readableMailboxIds.has(message.recipient_mailbox_id));
  const sent = messages.filter((message) => readableMailboxIds.has(message.sender_mailbox_id));
  const unreadCount = inbox.filter((message) => !readIds.has(message.id)).length;
  const renderMessages = (items: typeof messages, kind: "inbox" | "sent") => items.length === 0 ? (
    <p className="muted">Aucun message dans cette boîte.</p>
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
              Les adresses privées .mgmail conservent leur acheminement dans MAGNISA.
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
                  <label htmlFor="mgmail-namespace">Nom d'entreprise pour les adresses internes</label>
                  <input id="mgmail-namespace" name="slug" minLength={2} maxLength={45}
                    placeholder="mitalia" pattern="[a-z0-9]+(-[a-z0-9]+)*" required />
                  <small>Exemple : finance@mitalia.mgmail (interne seulement).</small>
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
                    <label>Nom de l'adresse</label>
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
                  <thead><tr><th>Adresse</th><th>Lecture</th><th>Envoi</th><th>État</th><th>Gestion</th></tr></thead>
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
            {mine.length > 0 && (
              <FormDialog title="Nouveau message interne" buttonLabel="+ Nouveau message">
                <form action={sendInternal} className="form">
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
                </form>
              </FormDialog>
            )}
            {mine.length === 0 && <p className="muted">Aucune boîte active autorisée à envoyer ne vous est attribuée.</p>}
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
