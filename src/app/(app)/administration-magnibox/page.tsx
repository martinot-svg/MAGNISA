import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/current-org";

export const runtime = "nodejs";
const PATH = "/administration-magnibox";

async function reviewRequest(form: FormData) {
  "use server";
  const { supabase } = await requireUser();
  const requestType = String(form.get("requestType") || "");
  const requestId = String(form.get("requestId") || "");
  const decision = String(form.get("decision") || "");
  const note = String(form.get("note") || "").trim();
  if (!["domain","address"].includes(requestType) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId) ||
      !["reviewing","approved","rejected"].includes(decision) ||
      note.length < 4 || note.length > 500) {
    throw new Error("Décision ou motif invalide.");
  }
  const { error } = await supabase.rpc("magnibox_platform_review_mail_request", {
    p_request_type: requestType,
    p_request_id: requestId,
    p_decision: decision,
    p_note: note,
  });
  if (error) throw new Error(error.message || "Décision non enregistrée.");
  revalidatePath(PATH);
}

type RequestRow = {
  request_type: "domain" | "address";
  request_id: string;
  organization_id: string;
  domain_name: string;
  email_address: string | null;
  request_status: string;
  created_at: string;
};

const statusLabels: Record<string,string> = {
  pending: "En attente",
  reviewing: "En cours d'examen",
  verified: "Propriété DNS vérifiée",
  approved: "Adresse approuvée",
  rejected: "Rejetée",
};

export default async function MagniboxPlatformAdministration() {
  const { supabase } = await requireUser();
  const { data, error } = await supabase.rpc("magnibox_platform_mail_requests");
  if (error) {
    return (
      <main className="section">
        <div className="pageHead">
          <div><p className="eyebrow">MAGNISA · Administration centrale</p>
            <h1>Administration Magnibox</h1>
            <p>Examen des demandes de domaines et d'adresses Internet des entreprises.</p>
          </div>
        </div>
        <section className="card section" role="alert">
          <h2>Accès réservé</h2>
          <p>Cette console est exclusivement réservée au propriétaire explicitement autorisé
            de MAGNISA, avec authentification multifacteur de niveau AAL2.</p>
          <p className="muted">Un administrateur d'entreprise ne peut pas accéder à cette console
            ni approuver ses propres demandes.</p>
        </section>
      </main>
    );
  }
  const rows = (data || []) as RequestRow[];
  const domains = rows.filter(row => row.request_type === "domain");
  const addresses = rows.filter(row => row.request_type === "address");
  function RequestTable({ items }: { items: RequestRow[] }) {
    if (!items.length) return <p className="muted">Aucune demande dans cette catégorie.</p>;
    return <div className="tableWrap"><table>
      <thead><tr><th>Entreprise (ID)</th><th>Domaine / adresse</th><th>État</th><th>Demande reçue</th><th>Décision</th></tr></thead>
      <tbody>{items.map(item => <tr key={item.request_id}>
        <td><code>{item.organization_id}</code></td>
        <td>{item.email_address || item.domain_name}</td>
        <td>{statusLabels[item.request_status] || item.request_status}</td>
        <td>{new Date(item.created_at).toLocaleString("fr-FR")}</td>
        <td><form action={reviewRequest} className="form">
          <input type="hidden" name="requestType" value={item.request_type}/>
          <input type="hidden" name="requestId" value={item.request_id}/>
          <select name="decision" defaultValue="reviewing" aria-label="Décision">
            <option value="reviewing">Mettre en examen</option>
            {item.request_type === "address" && <option value="approved">Approuver l'adresse</option>}
            <option value="rejected">Rejeter</option>
          </select>
          <input name="note" minLength={4} maxLength={500} placeholder="Motif obligatoire" required/>
          <button className="button primary" type="submit">Enregistrer</button>
        </form></td>
      </tr>)}</tbody>
    </table></div>;
  }
  return (
    <main className="section">
      <header className="pageHead"><div>
        <p className="eyebrow">MAGNISA · Administration centrale</p>
        <h1>Administration Magnibox</h1>
        <p>Décisions centralisées sur les demandes de domaines et d'adresses professionnelles.</p>
      </div></header>
      <section className="card section">
        <h2>Règles de validation</h2>
        <ul>
          <li>La propriété d'un domaine est établie par la vérification DNS côté serveur, jamais par une simple décision manuelle.</li>
          <li>Une adresse ne peut être approuvée que si son domaine est vérifié et sa boîte interne active.</li>
          <li>Une approbation ne crée pas encore une boîte Internet et n'active pas le transport SMTP.</li>
          <li>Chaque décision exige un motif et est inscrite dans le journal d'audit privé.</li>
        </ul>
      </section>
      <section className="card section">
        <h2>Demandes de domaines ({domains.length})</h2>
        <RequestTable items={domains}/>
      </section>
      <section className="card section">
        <h2>Demandes d'adresses ({addresses.length})</h2>
        <RequestTable items={addresses}/>
      </section>
    </main>
  );
}
