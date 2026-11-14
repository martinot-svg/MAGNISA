import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const endpoint=process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!endpoint||!anonKey||!serviceKey)throw Error("Action tasks: use an isolated local Supabase stack.");
const client=key=>createClient(endpoint,key,{auth:{persistSession:false,autoRefreshToken:false}});
const admin=client(serviceKey),token=randomUUID().slice(0,10);
const must=(x,name)=>{if(x.error||!x.data)throw Error(name+": "+x.error?.message);return x.data;};
const blocked=(x,name)=>{if(x.error)return;if(Array.isArray(x.data)&&!x.data.length)return;throw Error(name+": unauthorized operation succeeded");};
async function identity(role){
 const email=`orbit-action-${role}-${token}@magnisa.test`;
 const password=`OA-${randomBytes(18).toString("hex")}!a9`;
 const created=must(await admin.auth.admin.createUser({email,password,email_confirm:true}),"Create user");
 const account=client(anonKey);
 const signed=await account.auth.signInWithPassword({email,password});
 if(signed.error)throw signed.error;
 return {id:created.user.id,account};
}
const owner=await identity("owner");
const colleague=await identity("member");
const outsider=await identity("outsider");
const org=must(await owner.account.rpc("create_organization",{
 p_name:`Orbit Action CI ${token}`,p_currency:"MGA",
}),"Organization");
const otherOrg=must(await outsider.account.rpc("create_organization",{
 p_name:`Orbit Other CI ${token}`,p_currency:"MGA",
}),"Other organization");
const membership=await admin.from("organization_members").insert({
 organization_id:org,user_id:colleague.id,role:"employee",status:"active",
});
if(membership.error)throw membership.error;

const linkedProject=must(await admin.from("projects").insert({
 organization_id:org,name:`Orbit project ${token}`,status:"planned",
}).select("id").single(),"Project fixture");
const foreignProject=must(await admin.from("projects").insert({
 organization_id:otherOrg,name:`Foreign project ${token}`,status:"planned",
}).select("id").single(),"Other project fixture");

const task=must(await owner.account.from("orbit_action_tasks").insert({
 organization_id:org,project_id:linkedProject.id,
 created_by:owner.id,assigned_to:colleague.id,
 title:`Préparer le compte rendu ${token}`,priority:"high",due_date:"2026-12-10",
}).select("id,status,assigned_to").single(),"Assigned task");
if(task.status!=="todo"||task.assigned_to!==colleague.id)throw Error("Task creation mismatch");

const child=must(await owner.account.from("orbit_action_tasks").insert({
 organization_id:org,parent_task_id:task.id,created_by:owner.id,
 assigned_to:owner.id,title:`Relire les pièces ${token}`,
}).select("id,parent_task_id").single(),"Subtask");
if(child.parent_task_id!==task.id)throw Error("Subtask not linked");

const completed=must(await colleague.account.from("orbit_action_tasks")
 .update({status:"in_progress"}).eq("id",task.id).select("status").single(),"Assignee update");
if(completed.status!=="in_progress")throw Error("Assignee cannot advance task");
const comment=must(await colleague.account.from("orbit_action_comments").insert({
 organization_id:org,task_id:task.id,author_user_id:colleague.id,
 body:"Document revu par le collaborateur.",
}).select("id").single(),"Task comment");
const ownerComment=must(await owner.account.from("orbit_action_comments")
 .select("id").eq("id",comment.id).single(),"Shared comment read");
if(ownerComment.id!==comment.id)throw Error("Comment not visible to company");

blocked(await outsider.account.from("orbit_action_tasks").select("id").eq("organization_id",org),
 "Non-member cannot see tasks");
blocked(await outsider.account.from("orbit_action_comments").select("id").eq("organization_id",org),
 "Non-member cannot see comments");
blocked(await outsider.account.from("orbit_action_tasks")
 .update({status:"done"}).eq("id",task.id).select("id"),
 "Non-member cannot update task");
blocked(await owner.account.from("orbit_action_tasks").insert({
 organization_id:org,project_id:foreignProject.id,
 created_by:owner.id,title:"Fuite de projet refusée",
}).select("id"),"Foreign project cannot be linked");
blocked(await owner.account.from("orbit_action_tasks")
 .update({assigned_to:outsider.id}).eq("id",task.id).select("id"),
 "Cannot assign task outside organization");
blocked(await owner.account.from("orbit_action_comments").insert({
 organization_id:otherOrg,task_id:task.id,
 author_user_id:owner.id,body:"Fuite de commentaire",
}).select("id"),"Cannot cross organizations via comment");

console.log("PASS Orbit Action: tasks, subtasks, project link, comments, assignments and tenant RLS.");
