"use client";

import { useCallback, useEffect, useState } from "react";

type Identity = { id: string; email_address: string; status: string; receive_enabled: boolean };
type Message = {
  id: string; direction: "incoming" | "outgoing"; status: string;
  from_email: string; to_emails: string[]; subject: string; body_text: string; created_at: string;
  attachments: Array<{ id: string; display_name: string; byte_size: number }>;
};
const statusLabel: Record<string,string> = {
  queued: "En file", sending: "Envoi en cours", accepted: "Accepté par le serveur",
  delivered: "Livré", failed: "Échec", bounced: "Rejeté", uncertain: "À vérifier",
  received: "Reçu",
};

export function MagniboxInternetWorkspace() {
  const [identities,setIdentities]=useState<Identity[]>([]);
  const [identityId,setIdentityId]=useState("");
  const [messages,setMessages]=useState<Message[]>([]);
  const [to,setTo]=useState("");
  const [subject,setSubject]=useState("");
  const [body,setBody]=useState("");
  const [attachmentIds,setAttachmentIds]=useState<string[]>([]);
  const [draftFiles,setDraftFiles]=useState<File[]>([]);
  const [draftId,setDraftId]=useState("");
  const [draftRequestId,setDraftRequestId]=useState("");
  const [savingDraft,setSavingDraft]=useState(false);
  const [loading,setLoading]=useState(true);
  const [sending,setSending]=useState(false);
  const [error,setError]=useState("");
  const [feedback,setFeedback]=useState("");

  const selected=identities.find(item=>item.id===identityId) ?? null;
  const loadMessages=useCallback(async(id:string)=>{
    if(!id){setMessages([]);return;}
    const response=await fetch(`/api/magnibox/internet/messages?identityId=${encodeURIComponent(id)}`,{cache:"no-store"});
    const data=await response.json();
    if(!response.ok) throw new Error(data?.error || "Impossible de charger les messages.");
    setMessages(data.items || []);
  },[]);

  const loadIdentities=useCallback(async()=>{
    setLoading(true);setError("");
    try{
      const response=await fetch("/api/magnibox/internet/identities",{cache:"no-store"});
      const data=await response.json();
      if(!response.ok) throw new Error(data?.error || "Impossible de charger les boîtes.");
      const items:Identity[]=data.items || [];
      setIdentities(items);
      setIdentityId(current=>items.some(item=>item.id===current)?current:(items[0]?.id || ""));
    }catch(e){setError(e instanceof Error?e.message:"Impossible de charger les boîtes.");}
    finally{setLoading(false);}
  },[]);

  useEffect(()=>{void loadIdentities();},[loadIdentities]);
  useEffect(()=>{
    setAttachmentIds([]);setDraftFiles([]);setDraftId("");setDraftRequestId("");
    if(!identityId){setMessages([]);return;}
    void loadMessages(identityId).catch(e=>setError(e instanceof Error?e.message:"Chargement impossible."));
  },[identityId,loadMessages]);

  const saveDraft=async()=>{
    if(!selected || selected.status!=="active" || savingDraft || sending) return;
    setSavingDraft(true);setError("");setFeedback("");
    try{
      let currentDraftId=draftId;
      if(!currentDraftId){
        const recipients=to.split(/[;,\\s]+/).map(value=>value.trim()).filter(Boolean);
        const response=await fetch("/api/magnibox/internet/drafts",{
          method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({identityId:selected.id,to:recipients,subject,text:body}),
        });
        const data=await response.json();
        if(!response.ok || !data.draft?.id) throw new Error(data?.error || "Création du brouillon impossible.");
        currentDraftId=data.draft.id;setDraftId(currentDraftId);
      }
      for(const file of draftFiles){
        const form=new FormData();form.set("draftId",currentDraftId);form.set("file",file);
        const response=await fetch("/api/magnibox/internet/drafts/attachments",{method:"POST",body:form});
        const data=await response.json();
        if(!response.ok) throw new Error(data?.error || "Téléversement d'une pièce jointe impossible.");
        setDraftFiles(current=>current.filter(item=>item!==file));
      }
      setDraftFiles([]);
      setFeedback("Brouillon enregistré. Les pièces jointes sont en quarantaine privée et ne seront utilisables qu'après validation antivirus.");
    }catch(e){setError(e instanceof Error?e.message:"Enregistrement du brouillon impossible.");}
    finally{setSavingDraft(false);}
  };

  const send=async(event:React.FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    if(!selected || selected.status!=="active" || sending || savingDraft) return;
    setSending(true);setError("");setFeedback("");
    try{
      if(draftId){
        const requestId=draftRequestId || crypto.randomUUID();
        if(!draftRequestId) setDraftRequestId(requestId);
        const response=await fetch("/api/magnibox/internet/drafts/send",{
          method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({draftId,requestId}),
        });
        const data=await response.json();
        if(!response.ok && response.status!==202) throw new Error(data?.error || "Envoi du brouillon impossible.");
        if(data.state==="accepted"){
          setFeedback("Brouillon envoyé : le serveur SMTP MAGNIBOX a accepté le message. La livraison finale reste à confirmer.");
          setTo("");setSubject("");setBody("");setAttachmentIds([]);setDraftFiles([]);setDraftId("");setDraftRequestId("");
        }else{
          setFeedback(data.state==="uncertain"?"Envoi non confirmé. Ne créez pas une nouvelle demande : consultez l'historique SMTP.":"Demande déjà enregistrée. État : "+(data.state || "en cours"));
        }
        await loadMessages(selected.id);
        return;
      }
      const response=await fetch("/api/magnibox/internet/send",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({identityId:selected.id,requestId:crypto.randomUUID(),to,subject,text:body,attachmentIds}),
      });
      const data=await response.json();
      if(!response.ok && response.status!==202) throw new Error(data?.error || "Envoi impossible.");
      setFeedback(data.state==="accepted"?"Message accepté par le serveur MAGNIBOX. La livraison finale reste à confirmer.":"Demande enregistrée. Consultez son statut avant toute nouvelle tentative.");
      setTo("");setSubject("");setBody("");setAttachmentIds([]);
      await loadMessages(selected.id);
    }catch(e){setError(e instanceof Error?e.message:"Envoi impossible.");}
    finally{setSending(false);}
  };

  return (
    <section className="card section" style={{marginBottom:18}}>
      <div className="pageHead" style={{marginBottom:14}}>
        <div>
          <p className="eyebrow">MAGNIBOX · Courrier Internet natif</p>
          <h2>Boîtes professionnelles</h2>
          <p className="muted">Envoi et réception par l'infrastructure MAGNIBOX, sans compte Gmail obligatoire.</p>
        </div>
        <button type="button" className="button" onClick={()=>void loadIdentities()}>Actualiser</button>
      </div>
      {error && <p role="alert" style={{color:"#b91c1c"}}>{error}</p>}
      {feedback && <p role="status" style={{color:"#166534"}}>{feedback}</p>}
      {loading ? <p className="muted">Chargement des boîtes…</p> : !identities.length ? (
        <div className="card" style={{padding:16}}>
          <strong>Aucune adresse Internet activée</strong>
          <p className="muted">Un administrateur doit d'abord vérifier un domaine, approuver une adresse et raccorder le serveur de messagerie MAGNIBOX.</p>
          <a className="button" href="/orbit/magnibox/domaines">Gérer les domaines</a>
        </div>
      ) : (
        <div className="magnibox-internet-grid">
          <div>
            <label htmlFor="magnibox-internet-identity">Adresse professionnelle</label>
            <select id="magnibox-internet-identity" className="input" value={identityId} onChange={e=>setIdentityId(e.target.value)} style={{width:"100%"}}>
              {identities.map(item=><option key={item.id} value={item.id}>{item.email_address} · {item.status}</option>)}
            </select>
            {selected && <p className="muted" style={{fontSize:13,marginTop:8}}>Réception : {selected.receive_enabled?"activée":"non activée"}</p>}
            <div className="card" style={{marginTop:14,padding:12}}>
              <strong>Rédiger un message</strong>
              {selected?.status!=="active" ? <p className="muted">Cette adresse n'est pas encore activée pour l'envoi.</p> : (
                <form onSubmit={send} style={{display:"grid",gap:9,marginTop:10}}>
                  <label htmlFor="magnibox-to">Destinataire</label>
                  <input id="magnibox-to" value={to} onChange={e=>setTo(e.target.value)} disabled={!!draftId || savingDraft || sending} placeholder="client@exemple.com" required />
                  <label htmlFor="magnibox-subject">Objet</label>
                  <input id="magnibox-subject" value={subject} onChange={e=>setSubject(e.target.value)} disabled={!!draftId || savingDraft || sending} maxLength={180} required />
                  <label htmlFor="magnibox-body">Message</label>
                  <textarea id="magnibox-body" value={body} onChange={e=>setBody(e.target.value)} disabled={!!draftId || savingDraft || sending} rows={6} maxLength={50000} required />
                  <label htmlFor="magnibox-draft-files">Pièces jointes du brouillon (5 maximum, 30 Mio chacune)</label>
                  <input id="magnibox-draft-files" type="file" multiple onChange={event=>setDraftFiles(Array.from(event.target.files || []).slice(0,5))} disabled={!!draftId || savingDraft} />
                  {draftFiles.length>0 && <p className="muted" style={{fontSize:12}}>{draftFiles.length} fichier(s) prêt(s) à être déposés en quarantaine.</p>}
                  {draftId && <p role="status" className="muted" style={{fontSize:12}}>Brouillon enregistré · {draftId.slice(0,8)}… Les fichiers déposés restent bloqués jusqu’au verdict antivirus.</p>}
                  <button className="button" type="button" onClick={()=>void saveDraft()} disabled={savingDraft || sending || !to.trim() || !subject.trim() || !body.trim()}>{savingDraft?"Enregistrement…":"Enregistrer le brouillon"}</button>
                  <button className="button primary" type="submit" disabled={sending || savingDraft}>{sending?"Envoi…":draftId?"Envoyer le brouillon":"Envoyer"}</button>
                  {draftId && <p className="muted" style={{fontSize:12}}>L’envoi est autorisé uniquement après validation antivirus de toutes les pièces jointes. La demande est protégée contre les doubles soumissions.</p>}
                </form>
              )}
            </div>
          </div>
          <div>
            <strong>Messages récents</strong>
            {!messages.length ? <p className="muted">Aucun message dans cette boîte.</p> : (
              <div style={{display:"grid",gap:10,marginTop:10}}>
                {messages.map(message=>(
                  <article key={message.id} className="card" style={{padding:12}}>
                    <div style={{display:"flex",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}>
                      <strong>{message.subject}</strong>
                      <span className="badge">{statusLabel[message.status] || message.status}</span>
                    </div>
                    <p className="muted" style={{fontSize:12}}>
                      {message.direction==="incoming"?"De":"À"} : {message.direction==="incoming"?message.from_email:message.to_emails.join(", ")}
                      {" · "}{new Intl.DateTimeFormat("fr-FR",{dateStyle:"short",timeStyle:"short"}).format(new Date(message.created_at))}
                    </p>
                    <p style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{message.body_text}</p>
                    {message.attachments?.length > 0 && (
                      <div style={{borderTop:"1px solid var(--border, #e5e7eb)",paddingTop:9,marginTop:9}}>
                        <strong style={{fontSize:13}}>Pièces jointes disponibles</strong>
                        <ul style={{margin:"6px 0 0",paddingLeft:18}}>
                          {message.attachments.map(file=>(
                            <li key={file.id}>
                              <a href={"/api/magnibox/attachments/download?id="+encodeURIComponent(file.id)}>{file.display_name}</a>
                              <span className="muted"> · {Math.max(1,Math.round(file.byte_size/1024))} Ko</span>
                              {message.direction==="incoming" && (
                                <label style={{display:"inline-flex",gap:6,alignItems:"center",marginLeft:10,fontSize:12}}>
                                  <input type="checkbox" checked={attachmentIds.includes(file.id)}
                                    onChange={event=>setAttachmentIds(current=>event.target.checked
                                      ? (current.length<5?[...current,file.id]:current)
                                      : current.filter(id=>id!==file.id))} />
                                  Transférer
                                </label>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
