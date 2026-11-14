import { requireUser } from "@/lib/current-org";
export default async function PlatformIdentityDirectory() {
  const { supabase } = await requireUser();
  // Authorization and MFA AAL2 are checked inside the PostgreSQL SECURITY DEFINER RPC.
  // Organization owners/admins are NOT platform identity owners.
  const { data: records, error } = await supabase.rpc("magnisa_platform_origin_directory");
  if (error) {
    return <main className="section"><h1>Accès restreint</h1>
      <p>Ce registre est exclusivement réservé au propriétaire de MAGNISA avec authentification multifacteur.</p></main>;
  }
  return (
    <div className="section">
      <div className="pageHead"><div><h1>Registre confidentiel des inscriptions</h1>
        <p>Accès réservé au propriétaire de la plateforme. Ne pas exporter ni partager ce registre.</p></div></div>
      <div className="tableWrap"><table><thead><tr><th>ID public</th><th>Nom d’utilisateur</th><th>Code pays</th><th>Code localité</th><th>N° inscription</th></tr></thead>
        <tbody>{(records ?? []).map((entry: any)=><tr key={entry.user_public_id}>
          <td>{entry.user_public_id}</td><td>{entry.username ?? "—"}</td>
          <td>{entry.origin_country}</td><td>{entry.origin_locality}</td>
          <td>{String(entry.registration_number).padStart(8,"0")}</td>
        </tr>)}</tbody>
      </table></div>
    </div>
  );
}
