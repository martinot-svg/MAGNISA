"use client";
import { useActionState } from "react";

type Action = (state: any, data: FormData) => Promise<any>;
export function SubmitForm({action, children, submitLabel="Enregistrer"}:{action:Action;children:React.ReactNode;submitLabel?:string}){
  const [state,formAction,pending]=useActionState(action,{});
  return <form action={formAction} className="form">{children}{state?.error&&<p className="error">{state.error}</p>}{state?.success&&<p className="success">{state.success}</p>}<button className="button primary" disabled={pending}>{pending?"Traitement…":submitLabel}</button></form>
}
