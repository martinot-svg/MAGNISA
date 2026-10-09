"use client";
import { useActionState } from "react";
import { signIn } from "@/server/actions/auth";
export function LoginForm(){
  const [state,action,pending]=useActionState<any,FormData>(async(_:any,fd:FormData)=>signIn(fd),{});
  return <form action={action} className="form"><div className="field"><label>Adresse e-mail</label><input name="email" type="email" required autoComplete="email"/></div><div className="field"><label>Mot de passe</label><input name="password" type="password" required autoComplete="current-password"/></div>{state?.error&&<p className="error">{state.error}</p>}<button className="button primary" disabled={pending}>{pending?"Connexion…":"Se connecter"}</button></form>
}
