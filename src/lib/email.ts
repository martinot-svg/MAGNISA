import nodemailer from "nodemailer";

function emailHtml(code:string){return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:28px"><h2 style="color:#172033">MAGNISA</h2><p>Voici votre code de vérification :</p><div style="font-size:34px;font-weight:800;letter-spacing:10px;color:#1663FF;margin:24px 0">${code}</div><p>Ce code expire dans 5 minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.</p><p style="color:#667085">MAGNISA — Gérez mieux. Décidez mieux.</p></div>`}

export async function sendVerificationCodeEmail(email:string,code:string){
  const provider=(process.env.EMAIL_PROVIDER||"resend").toLowerCase();
  if(provider==="gmail_smtp"){
    const user=process.env.GMAIL_SMTP_USER;const pass=process.env.GMAIL_APP_PASSWORD;
    if(!user||!pass)throw new Error("Gmail SMTP non configuré. Renseigne GMAIL_SMTP_USER et GMAIL_APP_PASSWORD.");
    const transport=nodemailer.createTransport({service:"gmail",auth:{user,pass}});
    await transport.sendMail({from:`MAGNISA <${user}>`,to:email,subject:"Votre code de vérification MAGNISA",html:emailHtml(code)});return;
  }
  const key=process.env.RESEND_API_KEY;const from=process.env.EMAIL_FROM;
  if(!key||!from)throw new Error("Service e-mail non configuré. Renseigne RESEND_API_KEY et EMAIL_FROM, ou utilise EMAIL_PROVIDER=gmail_smtp.");
  const r=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify({from,to:[email],subject:"Votre code de vérification MAGNISA",html:emailHtml(code)})});
  if(!r.ok)throw new Error(`Envoi e-mail impossible (${r.status}).`);
}
