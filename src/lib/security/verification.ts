import crypto from "node:crypto";
const SECRET=process.env.EMAIL_CODE_SECRET||process.env.SUPABASE_SERVICE_ROLE_KEY||"";
export function generateCode(){return String(crypto.randomInt(0,10000)).padStart(4,"0");}
export function hashCode(userId:string,code:string){if(!SECRET)throw new Error("EMAIL_CODE_SECRET manquant");return crypto.createHmac("sha256",SECRET).update(`${userId}:${code}`).digest("hex");}
