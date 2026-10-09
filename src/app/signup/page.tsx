"use client";
import Link from "next/link";
import {useActionState,useEffect} from "react";
import {useRouter} from "next/navigation";
import {signUp} from "@/server/actions/auth";
import {BrandMark} from "@/components/brand-mark";
export default function Signup(){
  const router=useRouter();const [state,action,pending]=useActionState<any,FormData>(async(_:any,fd:FormData)=>signUp(fd),{});
  useEffect(()=>{if(state?.email)router.push(`/verify-email?email=${encodeURIComponent(state.email)}`)},[state,router]);
  return <main className="auth authPremium"><BrandMark/><div><p className="eyebrow">Créer votre espace</p><h1>Commencer avec MAGNISA</h1><p className="muted">Utilise une adresse <b>Gmail</b> ou l'adresse professionnelle de ton organisation. Les e-mails temporaires sont refusés.</p></div><form action={action} className="form"><div className="field"><label>Adresse e-mail</label><input name="email" type="email" required autoComplete="email" placeholder="direction@entreprise.mg"/></div><div className="field"><label>Mot de passe</label><input name="password" type="password" minLength={10} required autoComplete="new-password"/><small>10 caractères minimum.</small></div>{state?.error&&<p className="error">{state.error}</p>}<button disabled={pending} className="button primary">{pending?"Création…":"Créer mon compte"}</button></form><p className="muted"><Link href="/login">J'ai déjà un compte</Link></p></main>
}
