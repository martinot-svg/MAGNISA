import Link from "next/link";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireOrganization } from "@/lib/current-org";
import { hasPermission } from "@/lib/permissions";
import { FormDialog } from "@/components/form-dialog";
import { sendMGMailInternet } from "@/lib/magnimail/internet-send";

const PATH = "/magnimail/externe";

async function sendExternal(form: FormData) {
  "use server";
  const result = await sendMGMailInternet({
    identityId: String(form.get("identityId") || ""),
    requestKey: String(form.get("requestKey") || ""),
    to: String(form.get("to") || ""),
    subject: String(form.get("subject") || ""),
    body: String(form.get("body") || ""),
  });
  revalidatePath(PATH);
  if (result.status === "failed") {
    throw new Error("L'envoi a échoué. Consultez les échecs MGMail avant de réessayer.");
  }
  if (result.status === "uncertain" || result.status === "sending") {
    throw new Error("L'expédition n'est pas confirmée. Vérifiez son état dans MGMail avant tout nouvel essai.");
  }
}

const statusLabels: Record<string, string> = {
  queued: "En attente", sending: "En cours", accepted: "Accepté par le fournisseur",
  delivered: "Livré au serveur destinataire", bounced: "Rejeté",
  failed: "Échec", uncertain: "À vérifier", received: "Reçu",
};

export default async function MGMailInternetPage() {
  const ctx = await requireOrganization();
  const canManage = await hasPermission(ctx, "users.manage");
  const [identitiesResult, messagesResult] = await Promise.all([
    ctx.supabase.from("mgmail_external_identities")
      .select("id,email_address,mailbox_id,status,receive_enabled")
      .eq("organization_id", ctx.organizationId).order("email_address").limit(50),
    ctx.supabase.from("mgmail_external_messages")
      .select("id,identity_id,direction,status,from_email,to_emails,subject,body_text,last_error,created_at")
      .eq("organization_id", ctx.organizationId)
      .order("created_at", { ascending: false }).limit(100),
  ]);
  const identities = identitiesResult.data || [];
  const messages = messagesResult.data || [];
  const accessible = await Promise.all(identities.map(async (identity) => {
    const result = await ctx.supabase.rpc("mgmail_can_external_access", {
      p_org: ctx.organizationId, p_mailbox: identity.mailbox_id, p_action: "send",
    });
    return { ...identity, canSend: result.error === null && result.data === true };
  }));
  const addressById = new Map(identities.map((item) => [item.id, item.email_address]));
  const inbox = messages.filter((message) => message.direction === "incoming");
  const sent = messages.filter((message) => message.direction === "outgoing"
    && ["accepted", "delivered"].includes(message.status));
  const failed = messages.filter((message) => message.direction === "outgoing"
    && ["bounced", "failed", "uncertain"].includes(message.status));

  const renderItems = (items: typeof messages) => items.length === 0 ? (
    <p className="muted">Aucun message pour cette catégorie.</p>
  ) : (
    <div className="tableWrap">
      <table>
        <thead><tr><th>Date</th><th>Adresse MGMail</th><th>Correspondant</th><th>Objet</th><th>État</th></tr></thead>
        <tbody>
          {items.map((message) => (
            <tr key={message.id}>
              <td style={{ whiteSpace: "nowrap" }}>
                {new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" })
                  .format(new Date(message.created_at))}
              </td>
              <td>{addressById.get(message.identity_id) || "Boîte"}</td>
              <td style={{ overflowWrap: "anywhere" }}>
                {message.direction === "incoming" ? message.from_email :
                  message.to_emails.join(", ")}
              </td>
              <td style={{ overflowWrap: "anywhere" }}>
                <strong>{message.subject}</strong>
                {message.direction === "incoming" && message.body_text && (
                  <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                    {message.body_text}
                  </p>
                )}
                {message.last_error && <p className="muted">{message.last_error}</p>}
              </td>
              <td>
                {statusLabels[message.status] || message.status}
                {message.direction === "incoming" && accessible.some((item) =>
                  item.id === message.identity_id && item.status === "active" && item.canSend
                ) && (
                  <FormDialog buttonLabel="Répondre" title="Répondre au correspondant externe" buttonClassName="button">
                    <form action={sendExternal} className="form">
                      <input type="hidden" name="identityId" value={message.identity_id} />
                      <input type="hidden" name="requestKey" value={randomUUID()} />
                      <div className="field">
                        <label>Destinataire</label>
                        <input name="to" defaultValue={message.from_email} readOnly required />
                      </div>
                      <div className="field">
                        <label>Objet</label>
                        <input name="subject" required maxLength={180}
                          defaultValue={message.subject.startsWith("Re:") ? message.subject :
                            `Re: ${message.subject}`} />
                      </div>
                      <div className="field">
                        <label>Réponse</label>
                        <textarea name="body" rows={7} maxLength={50000} required />
                      </div>
                      <button className="button primary" type="submit">Envoyer la réponse</button>
                    </form>
                  </FormDialog>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <div className="pageHead">
        <div>
          <p className="eyebrow">MGMail · Messagerie Internet</p>
          <h1>E-mails externes</h1>
          <p>Communiquer avec Gmail, Outlook, Proton et les autres messageries Internet.</p>
        </div>
        <Link className="button" href="/magnimail">Retour à MGMail</Link>
      </div>
      <div className="card section">
        <strong>Adresses Internet authentiques uniquement</strong>
        <p className="muted">
          Les boîtes internes en .mgmail ne sont pas joignables depuis Internet.
          Une adresse publique doit d'abord être activée par MAGNISA après vérification
          du domaine et de l'infrastructure d'envoi et de réception.
          Aucun compte Google n'est obligatoire.
        </p>
      </div>
      {identitiesResult.error || messagesResult.error ? (
        <div className="card section" role="alert">
          Les boîtes Internet ne sont pas disponibles. Vérifiez les migrations et les autorisations.
        </div>
      ) : (
        <>
          <div className="card section">
            <h2>Adresses Internet attribuées</h2>
            {accessible.length === 0 ? (
              <p>
                Aucune adresse publique n'est encore attribuée à votre entreprise.
                {canManage && " L'activation nécessite un domaine vérifié et un fournisseur opérationnel."}
              </p>
            ) : (
              <div>
                {accessible.map((identity) => (
                  <div key={identity.id} className="card" style={{ marginBottom: 12 }}>
                    <strong>{identity.email_address}</strong>
                    <p className="muted">
                      {identity.status === "active" ? "Adresse activée" : "Adresse non activée"}
                      {" · Réception "}{identity.receive_enabled ? "configurée" : "non activée"}
                      {" · Envoi "}{identity.canSend && identity.status === "active" ? "autorisé" : "non autorisé"}
                    </p>
                    {identity.canSend && identity.status === "active" && (
                      <FormDialog buttonLabel="+ Nouveau message" title={`Envoyer depuis ${identity.email_address}`}>
                        <form action={sendExternal} className="form">
                          <input type="hidden" name="identityId" value={identity.id} />
                          <input type="hidden" name="requestKey" value={randomUUID()} />
                          <div className="field">
                            <label>Destinataires</label>
                            <input name="to" placeholder="client@gmail.com" required maxLength={2000} />
                            <small>Jusqu'à 10 adresses, séparées par une virgule.</small>
                          </div>
                          <div className="field">
                            <label>Objet</label>
                            <input name="subject" required maxLength={180} />
                          </div>
                          <div className="field">
                            <label>Message</label>
                            <textarea name="body" rows={8} maxLength={50000} required />
                          </div>
                          <button className="button primary" type="submit">Envoyer le message</button>
                        </form>
                      </FormDialog>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="card section"><h2>Boîte de réception Internet ({inbox.length})</h2>{renderItems(inbox)}</div>
          <div className="card section"><h2>Envois acceptés et livrés ({sent.length})</h2>{renderItems(sent)}</div>
          <div className="card section"><h2>Échecs et envois à vérifier ({failed.length})</h2>{renderItems(failed)}</div>
        </>
      )}
    </>
  );
}
