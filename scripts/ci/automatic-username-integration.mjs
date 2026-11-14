import { createClient } from "@supabase/supabase-js";

// Isolated Supabase CI only: verify atomic ten-letter username allocation.
const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!key)throw Error("Local Supabase CI settings missing.");
const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
const ids=[];
async function create(given,family,alias) {
  const email=`auto-name-${Date.now()}-${ids.length}@magnisa.test`;
  const metadata={full_name:`${given} ${family}`,given_names:given,family_name:family};
  if(alias)metadata.username=alias;
  const {data,error}=await admin.auth.admin.createUser({
    email,email_confirm:true,
    user_metadata:metadata,
  });
  if(error||!data.user)throw error??Error("Could not create test identity");
  ids.push(data.user.id);
  const result=await admin.from("profiles").select("username,public_id").eq("id",data.user.id).single();
  if(result.error)throw result.error;
  return result.data;
}
function verify(ok,msg){if(!ok)throw Error(msg);}
try {
  const first=await create("Francky","Kevin");
  verify(first.username==="franckykev","Unexpected generated username");
  const homonym=await create("Francky","Kevin");
  verify(homonym.username!==first.username && /^[a-z]{2,10}$/.test(homonym.username),"Homonym collision");
  const accented=await create("Élodie","Ràbé");
  verify(accented.username==="elodierabe","Accent normalization mismatch");
  const long=await create("Alexandrie","Rakoto");
  verify(long.username==="alexandrir","Family name lost");
  const spoofed=await create("Utilisateur","Historique","legacy.name");
  verify(spoofed.username!=="legacy.name" && /^[a-z]{2,10}$/.test(spoofed.username),
    "Client-supplied Auth metadata must not bypass auto-generation");
  for(const item of [first,homonym,accented,long,spoofed])
    verify(/^[0-9]{14}$/.test(item.public_id),"Public ID changed");
  console.log("PASS automatically generated usernames, homonyms, accents, and metadata override protection");
} finally {
  for(const id of ids.reverse())await admin.auth.admin.deleteUser(id);
}
