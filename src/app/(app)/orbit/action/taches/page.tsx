import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireOrganization } from "@/lib/current-org";
import { hasPermission } from "@/lib/permissions";
import { FormDialog } from "@/components/form-dialog";

const PATH = "/orbit/action/taches";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const statuses = [
  { key: "todo", label: "À faire" },
  { key: "in_progress", label: "En cours" },
  { key: "review", label: "À vérifier" },
  { key: "done", label: "Terminé" },
] as const;
const priorities: Record<string, string> = {
  low: "Faible", normal: "Normale", high: "Élevée", urgent: "Urgente",
};

async function createActionTask(form: FormData) {
  "use server";
  const ctx = await requireOrganization();
  const title = String(form.get("title") || "").trim();
  const description = String(form.get("description") || "").trim();
  const priority = String(form.get("priority") || "normal");
  const assigned = String(form.get("assignedTo") || "").trim();
  const parentTaskId = String(form.get("parentTaskId") || "").trim();
  const dueDate = String(form.get("dueDate") || "").trim();
  if (title.length < 2 || title.length > 180 || description.length > 10000 ||
      !Object.hasOwn(priorities, priority) ||
      (assigned && !UUID.test(assigned)) || (parentTaskId && !UUID.test(parentTaskId)) ||
      (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate))) {
    throw new Error("Les informations de la tâche sont invalides.");
  }
  const payload = {
    organization_id: ctx.organizationId,
    created_by: ctx.user.id,
    title, description, priority,
    assigned_to: assigned || null,
    parent_task_id: parentTaskId || null,
    due_date: dueDate || null,
  };
  const { error } = await ctx.supabase.from("orbit_action_tasks").insert(payload);
  if (error) throw new Error("Impossible de créer la tâche ou d'attribuer cette responsabilité.");
  revalidatePath(PATH);
}

async function updateActionTask(form: FormData) {
  "use server";
  const ctx = await requireOrganization();
  const id = String(form.get("id") || "");
  const status = String(form.get("status") || "");
  if (!UUID.test(id) || !statuses.some(item => item.key === status)) {
    throw new Error("Tâche ou état invalide.");
  }
  const { data, error } = await ctx.supabase.from("orbit_action_tasks")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("organization_id", ctx.organizationId).eq("id", id)
    .select("id").maybeSingle();
  if (error || !data) throw new Error("Modification refusée : tâche absente ou accès non autorisé.");
  revalidatePath(PATH);
}

async function commentActionTask(form: FormData) {
  "use server";
  const ctx = await requireOrganization();
  const taskId = String(form.get("taskId") || "");
  const body = String(form.get("body") || "").trim();
  if (!UUID.test(taskId) || !body || body.length > 10000) {
    throw new Error("Commentaire ou tâche invalide.");
  }
  const { error } = await ctx.supabase.from("orbit_action_comments").insert({
    organization_id: ctx.organizationId,
    task_id: taskId,
    author_user_id: ctx.user.id,
    body,
  });
  if (error) throw new Error("Ce commentaire ne peut pas être enregistré.");
  revalidatePath(PATH);
}

export default async function OrbitActionTasksPage() {
  const ctx = await requireOrganization();
  const canManage = await hasPermission(ctx, "users.manage");
  const [taskResult, commentResult, memberResult] = await Promise.all([
    ctx.supabase.from("orbit_action_tasks")
      .select("id,title,description,status,priority,created_by,assigned_to,parent_task_id,due_date,created_at")
      .eq("organization_id", ctx.organizationId).order("created_at", { ascending: false }).limit(300),
    ctx.supabase.from("orbit_action_comments")
      .select("id,task_id,body,created_at")
      .eq("organization_id", ctx.organizationId).order("created_at", { ascending: false }).limit(300),
    canManage
      ? ctx.supabase.rpc("organization_member_directory", { p_org: ctx.organizationId })
      : Promise.resolve({ data: [], error: null }),
  ]);
  const tasks = taskResult.data || [];
  const comments = commentResult.data || [];
  const members = ((memberResult.data || []) as {user_id:string;email:string;status:string}[])
    .filter(x => x.status === "active");
  const editable = (task: (typeof tasks)[number]) =>
    task.created_by === ctx.user.id || task.assigned_to === ctx.user.id || canManage;
  const childCount = (parentId: string) => tasks.filter(x => x.parent_task_id === parentId).length;
  const countByTask = (taskId: string) => comments.filter(c => c.task_id === taskId).length;

  return (
    <>
      <header className="pageHead">
        <div>
          <p className="eyebrow">Magnisa Orbit · Magnisa Action</p>
          <h1>Tâches et responsabilités</h1>
          <p>Création, suivi, sous-tâches et commentaires dans l'espace sécurisé de l'entreprise.</p>
        </div>
        <Link className="button" href="/orbit/action">Retour aux projets</Link>
      </header>
      {taskResult.error || commentResult.error ? (
        <div className="card section" role="alert">
          L'espace de tâches n'est pas disponible : sa migration doit d'abord être appliquée
          et ses autorisations contrôlées. Les projets historiques restent accessibles.
        </div>
      ) : (
        <>
          <div className="card section">
            <FormDialog title="Nouvelle tâche" buttonLabel="+ Créer une tâche">
              <form action={createActionTask} className="form">
                <div className="field"><label>Intitulé</label>
                  <input name="title" minLength={2} maxLength={180} required /></div>
                <div className="field"><label>Description</label>
                  <textarea name="description" rows={3} maxLength={10000} /></div>
                <div className="grid2">
                  <div className="field"><label>Priorité</label>
                    <select name="priority" defaultValue="normal">
                      {Object.entries(priorities).map(([key,value])=>
                        <option key={key} value={key}>{value}</option>)}
                    </select></div>
                  <div className="field"><label>Date limite</label>
                    <input name="dueDate" type="date" /></div>
                </div>
                {canManage && members.length > 0 ? (
                  <div className="field"><label>Responsable</label>
                    <select name="assignedTo" defaultValue={ctx.user.id}>
                      <option value="">Non attribuée</option>
                      {members.map(member=><option key={member.user_id} value={member.user_id}>
                        {member.email}</option>)}
                    </select>
                  </div>
                ) : <input type="hidden" name="assignedTo" value={ctx.user.id} />}
                <button className="button primary" type="submit">Enregistrer la tâche</button>
              </form>
            </FormDialog>
          </div>
          <div style={{overflowX:"auto"}}>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,minmax(230px,1fr))",gap:12,minWidth:980}}>
              {statuses.map(stage => (
                <section className="card section" key={stage.key} aria-label={stage.label}>
                  <h2>{stage.label} ({tasks.filter(t => t.status === stage.key).length})</h2>
                  {tasks.filter(task => task.status === stage.key).map(task => (
                    <article key={task.id} className="card" style={{marginBottom:10}}>
                      <strong>{task.title}</strong>
                      <p className="muted">{task.description}</p>
                      <small>Priorité : {priorities[task.priority] || task.priority}</small>
                      {task.due_date && <p className="muted">Échéance : {task.due_date}</p>}
                      {task.parent_task_id && <p className="muted">Sous-tâche</p>}
                      {childCount(task.id) > 0 && <p className="muted">{childCount(task.id)} sous-tâche(s)</p>}
                      <p className="muted">{countByTask(task.id)} commentaire(s)</p>
                      {editable(task) && (
                        <FormDialog title="Modifier la progression" buttonLabel="Changer l'état" buttonClassName="button">
                          <form action={updateActionTask} className="form">
                            <input type="hidden" name="id" value={task.id} />
                            <div className="field"><label>État</label>
                              <select name="status" defaultValue={task.status}>
                                {statuses.map(s=><option key={s.key} value={s.key}>{s.label}</option>)}
                              </select></div>
                            <button className="button primary" type="submit">Enregistrer</button>
                          </form>
                        </FormDialog>
                      )}
                      <FormDialog title="Ajouter un commentaire" buttonLabel="Commenter" buttonClassName="button">
                        <form action={commentActionTask} className="form">
                          <input type="hidden" name="taskId" value={task.id} />
                          <div className="field"><label>Commentaire</label>
                            <textarea name="body" rows={3} required maxLength={10000} /></div>
                          <button className="button primary" type="submit">Publier le commentaire</button>
                        </form>
                      </FormDialog>
                      <FormDialog title="Créer une sous-tâche" buttonLabel="+ Sous-tâche" buttonClassName="button">
                        <form action={createActionTask} className="form">
                          <input type="hidden" name="parentTaskId" value={task.id} />
                          <input type="hidden" name="assignedTo" value={ctx.user.id} />
                          <div className="field"><label>Titre</label>
                            <input name="title" minLength={2} maxLength={180} required /></div>
                          <div className="field"><label>Priorité</label>
                            <select name="priority" defaultValue="normal">
                              {Object.entries(priorities).map(([key,value])=>
                                <option key={key} value={key}>{value}</option>)}
                            </select></div>
                          <button className="button primary" type="submit">Créer la sous-tâche</button>
                        </form>
                      </FormDialog>
                    </article>
                  ))}
                  {!tasks.some(task=>task.status===stage.key) && <p className="muted">Aucune tâche.</p>}
                </section>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}
