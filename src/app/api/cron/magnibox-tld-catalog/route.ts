import {NextResponse} from "next/server";
import {getCronAuthorizationError} from "@/lib/cron-auth";
import {synchronizeMagniboxTlds} from "@/lib/orbit/tld-sync";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export async function GET(request:Request){
 const authError=getCronAuthorizationError(process.env.CRON_SECRET,request.headers.get("authorization"));
 if(authError===503)return NextResponse.json({error:"CRON_SECRET manquant"},{status:503});
 if(authError===401)return NextResponse.json({error:"Non autorisé"},{status:401});
 try{return NextResponse.json({ok:true,...await synchronizeMagniboxTlds()});}
 catch(error){console.error("Magnibox catalogue sync failed",error);
   return NextResponse.json({error:"Synchronisation impossible, aucun statut de disponibilité modifié."},{status:503});}
}
