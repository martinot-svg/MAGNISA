const BLOCKED_FREE_DOMAINS = new Set([
  "outlook.com","hotmail.com","live.com","yahoo.com","yahoo.fr","icloud.com","me.com","aol.com","proton.me","protonmail.com"
]);
const DISPOSABLE_HINTS = ["mailinator","tempmail","10minutemail","guerrillamail","yopmail","trashmail","dispostable"];

export function signupEmailPolicy(email: string) {
  const normalized=email.trim().toLowerCase();
  const at=normalized.lastIndexOf("@");
  if(at<=0||at===normalized.length-1) return {ok:false,reason:"Adresse e-mail invalide."};
  const domain=normalized.slice(at+1);
  if(domain==="gmail.com") return {ok:true,kind:"gmail" as const,normalized};
  if(DISPOSABLE_HINTS.some(x=>domain.includes(x))) return {ok:false,reason:"Les adresses e-mail temporaires ou jetables ne sont pas acceptées."};
  if(BLOCKED_FREE_DOMAINS.has(domain)) return {ok:false,reason:"Utilise une adresse Gmail ou une adresse professionnelle liée au domaine de ton organisation."};
  if(!domain.includes(".")||domain.startsWith(".")||domain.endsWith(".")) return {ok:false,reason:"Le domaine professionnel est invalide."};
  return {ok:true,kind:"professional" as const,normalized};
}

export function isAllowedSignupEmail(email:string){return signupEmailPolicy(email).ok;}
