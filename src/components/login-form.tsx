"use client";
import { useState } from "react";
import { useActionState } from "react";
import { signIn } from "@/server/actions/auth";

export function LoginForm(){
  const [state,action,pending]=useActionState<any,FormData>(async(_:any,fd:FormData)=>signIn(fd),{});
  const [showPassword,setShowPassword]=useState(false);

  return <form action={action} className="form">
    <div className="field"><label>Adresse e-mail</label><input name="email" type="email" required autoComplete="email"/></div>
    <div className="field">
      <label htmlFor="login-password">Mot de passe</label>
      <div style={{position:"relative"}}>
        <input id="login-password" name="password" type={showPassword?"text":"password"} required autoComplete="current-password" style={{paddingRight:48,width:"100%"}}/>
        <button
          type="button"
          aria-label={showPassword?"Masquer le mot de passe":"Afficher le mot de passe"}
          aria-pressed={showPassword}
          onClick={()=>setShowPassword(value=>!value)}
          title={showPassword?"Masquer le mot de passe":"Afficher le mot de passe"}
          style={{position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",width:36,height:36,border:0,background:"transparent",display:"grid",placeItems:"center",cursor:"pointer",padding:0}}
        >
          {showPassword ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" stroke="currentColor" strokeWidth="1.8"/><circle cx="12" cy="12" r="2.7" stroke="currentColor" strokeWidth="1.8"/></svg> : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 3l18 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><path d="M10.6 6.2A10.4 10.4 0 0 1 12 6c6 0 9.5 6 9.5 6a17.4 17.4 0 0 1-3.1 3.6M6.2 6.8C3.9 8.2 2.5 12 2.5 12s3.5 6 9.5 6c1.3 0 2.5-.3 3.5-.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>}
        </button>
      </div>
    </div>
    {state?.error&&<p className="error">{state.error}</p>}
    <button className="button primary" disabled={pending}>{pending?"Connexion…":"Se connecter"}</button>
  </form>
}
