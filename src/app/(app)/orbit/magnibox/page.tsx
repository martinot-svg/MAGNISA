import Link from "next/link";
import { requireOrganization } from "@/lib/current-org";
export const dynamic = "force-dynamic";
export default async function MagniboxHome(){
 const ctx=await requireOrganization();
 const [mailboxes,identities,events]=await Promise.all([
  ctx.supabase.from("magnibox_internal_mailboxes").select("id",{count:"exact",head:true}).eq("organization_id",ctx.organizationId).eq("is_active",true),
  ctx.supabase.from("orbit_public_identities").select("id",{count:"exact",head:true}).eq("organization_id",ctx.organizationId).eq("status","active"),
  ctx.supabase.from("magnibox_agenda_events").select("id,title,start_day,start_time",{count:"exact"}).eq("organization_id",ctx.organizationId).gte("start_day",new Date().toISOString().slice(0,10)).order("start_day").order("start_time").limit(3)
 ]);
 const upcoming=events.error?[]:events.data||[];
 const value=(count:number|null|undefined,error:unknown)=>error?"—":String(count??0);
 return <><div className="pageHead"><div><p className="eyebrow">Magnisa Orbit · Communication</p><h1>Bienvenue dans MAGNIBOX</h1><p>Votre espace professionnel de messagerie, de collaboration et d’agenda.</p></div><Link className="button primary" href="/orbit/magnibox/messagerie">Ouvrir la messagerie</Link></div>
 <div className="mg-home-grid" aria-label="Indicateurs MAGNIBOX">
 <article className="mg-home-card"><small>BOÎTES INTERNES ACTIVES</small><div className="mg-home-value">{value(mailboxes.count,mailboxes.error)}</div><p>Boîtes collaborateur actives dans cette entreprise</p></article>
 <article className="mg-home-card"><small>ADRESSES PROFESSIONNELLES ACTIVES</small><div className="mg-home-value">{value(identities.count,identities.error)}</div><p>Identités Internet avec statut actif</p></article>
 <article className="mg-home-card"><small>RENDEZ-VOUS À VENIR</small><div className="mg-home-value">{value(events.count,events.error)}</div><p>{events.error?"Agenda indisponible ou non activé":"Événements enregistrés à venir"}</p></article>
 </div>
 <section className="mg-home-section"><h2>Accès rapides</h2><div className="mg-home-links">
 <Link className="mg-home-link" href="/orbit/magnibox/messagerie">✉ Consulter les messages</Link>
 <Link className="mg-home-link" href="/orbit/magnibox/boites">▣ Gérer les boîtes et accès</Link>
 <Link className="mg-home-link" href="/orbit/magnibox/courrier">◎ Adresses professionnelles</Link>
 <Link className="mg-home-link" href="/orbit/magnibox/agenda">▦ Ouvrir l’agenda</Link>
 <Link className="mg-home-link" href="/orbit/magnibox/administration">⚙ Administration</Link></div></section>
 <section className="mg-home-section"><h2>À venir dans l’agenda</h2>{events.error?<div className="card"><p className="muted">Les données de l’agenda ne sont pas disponibles pour le moment.</p></div>:upcoming.length?<div className="card">{upcoming.map(event=><div key={event.id} style={{padding:"10px 0",borderBottom:"1px solid var(--line)"}}><strong>{event.title}</strong><p className="muted" style={{margin:"5px 0 0"}}>{event.start_day}{event.start_time?" · "+event.start_time:""}</p></div>)}</div>:<div className="card"><p className="muted">Aucun rendez-vous à venir n’est enregistré.</p><Link className="button" href="/orbit/magnibox/agenda">Ouvrir l’agenda</Link></div>}</section>
 <p className="muted compact" style={{marginTop:18}}>Les indicateurs proviennent des données de l’entreprise. « — » signale une donnée indisponible, jamais une valeur fictive.</p></>;
}