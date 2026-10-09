import Link from "next/link";
import {signOut} from "@/server/actions/auth";
import {requireOrganization} from "@/lib/current-org";
import {FEATURE_CATALOG} from "@/lib/features";
import {BrandMark} from "@/components/brand-mark";
export async function AppShell({children}:{children:React.ReactNode}){
  const {supabase,organizationId}=await requireOrganization();
  const {data:rows=[]}=await supabase.from("organization_features").select("feature_key,enabled").eq("organization_id",organizationId);
  const enabled=new Map(rows.map((r:any)=>[r.feature_key,r.enabled]));
  const visible=FEATURE_CATALOG.filter(f=>f.required||f.key==="settings"||enabled.get(f.key)!==false);
  let lastGroup="";
  return <div className="appShell"><aside><BrandMark href="/dashboard" compact/><nav>{visible.map(f=>{const showGroup=f.group!==lastGroup;lastGroup=f.group;return <div key={f.key}>{showGroup&&<div style={{padding:"15px 10px 5px",fontSize:9,textTransform:"uppercase",letterSpacing:'.14em',color:'#71819f'}}>{f.group}</div>}<Link href={f.href}>{f.label}</Link></div>})}</nav><form action={signOut}><button className="button ghost">Se déconnecter</button></form></aside><main>{children}</main></div>;
}
