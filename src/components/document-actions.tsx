"use client";
export function DocumentActions({pdfUrl,email,subject,body}:{pdfUrl:string;email?:string|null;subject:string;body:string}){
  const prepareEmail=async()=>{
    const response=await fetch(pdfUrl); if(!response.ok){alert("Impossible de générer le PDF.");return;}
    const blob=await response.blob(); const file=new File([blob],"document-magnisa.pdf",{type:"application/pdf"});
    const nav=navigator as Navigator & {canShare?:(d:any)=>boolean;share?:(d:any)=>Promise<void>};
    if(nav.share && nav.canShare?.({files:[file]})) { await nav.share({title:subject,text:body,files:[file]}); return; }
    const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=file.name;a.click();URL.revokeObjectURL(a.href);
    window.location.href=`mailto:${encodeURIComponent(email||"")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body+"\n\nLe PDF a été téléchargé sur cet appareil ; joignez-le à ce message.")}`;
  };
  return <div className="actions"><a className="button" href={pdfUrl} target="_blank">Aperçu / PDF</a>{email&&<button className="button primary" onClick={prepareEmail}>Préparer l'e-mail</button>}</div>;
}
