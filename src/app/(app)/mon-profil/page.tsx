import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/current-org";
import { REGISTRATION_COUNTRY_CODE, REGISTRATION_COUNTRY_NAME, REGISTRATION_LOCALITIES, GENERATED_USERNAME_PATTERN, normalizeUsername } from "@/lib/auth/magnisa-identity";
import { FormDialog } from "@/components/form-dialog";

async function saveProfile(formData: FormData) {
  "use server";
  const { supabase, user } = await requireUser();
  const fullName = String(formData.get("full_name") || "").trim();
  const username = normalizeUsername(String(formData.get("username") || ""));
  const locality = String(formData.get("locality_code") || "");
  if (fullName.length < 2 || fullName.length > 120) {
    throw new Error("Le prénom et le nom sont requis (120 caractères maximum).");
  }
  const { data: existingProfile, error: profileError } = await supabase.from("profiles")
    .select("username").eq("id", user.id).single();
  if (profileError) throw new Error("Impossible de vérifier le nom d’utilisateur actuel.");
  if (username && username !== existingProfile.username && !GENERATED_USERNAME_PATTERN.test(username)) {
    throw new Error("Le nom d’utilisateur doit contenir entre 2 et 10 lettres, sans chiffres ni signes.");
  }
  if (locality && !REGISTRATION_LOCALITIES.some(item => item.code === locality)) {
    throw new Error("Localité d'inscription invalide.");
  }
  const { error } = await supabase.rpc("claim_magnisa_identity", {
    p_full_name: fullName,
    p_username: username,
    p_country: locality ? REGISTRATION_COUNTRY_CODE : "",
    p_locality: locality,
  });
  if (error) {
    if (error.code === "23505") throw new Error("Ce nom d’utilisateur est déjà utilisé.");
    throw new Error(error.message || "Impossible d'enregistrer l'identité MAGNISA.");
  }
  revalidatePath("/mon-profil");
  revalidatePath("/utilisateurs");
}

export default async function MyMagnisaProfile() {
  const { supabase, user } = await requireUser();
  const [{ data: profile, error }, { data: registered, error: registrationError }] = await Promise.all([
    supabase.from("profiles").select("email,full_name,username,public_id,username_changed_at")
      .eq("id",user.id).maybeSingle(),
    supabase.rpc("has_magnisa_registration"),
  ]);
  if (error || !profile) throw new Error("Profil indisponible.");
  if (registrationError) throw new Error("Impossible de vérifier le lieu d'inscription.");
  return (
    <>
      <div className="pageHead">
        <div><p className="eyebrow">Identité MAGNISA</p><h1>Mon profil utilisateur</h1>
          <p>Identité permanente sur toutes tes entreprises. Ton numéro public ne dévoile pas ton lieu ni ton ordre d'inscription.</p>
        </div>
      </div>
      <div className="section grid2">
        <section className="card">
          <p className="eyebrow">Mon identité</p>
          <h2>{profile.full_name || "Profil à compléter"}</h2>
          <p className="muted">@{profile.username || "nom d’utilisateur à définir"}</p>
          <div style={{display:"grid",gap:5,marginTop:14}}>
            <span className="muted">Mon numéro ID MAGNISA</span>
            <strong style={{fontVariantNumeric:"tabular-nums",whiteSpace:"nowrap",fontSize:"clamp(18px,2vw,24px)",overflowX:"auto"}}>
              {profile.public_id || "Attribution en attente"}
            </strong>
          </div>
          <p className="muted" style={{marginTop:12}}>E-mail vérifié : {profile.email}</p>
          <p className="muted">Ce numéro reste permanent, y compris si tu déménages ou changes d'entreprise.</p>
        </section>
        <section className="card">
          <h2>Mes informations</h2>
          <p className="muted">Le nom d'utilisateur est généré automatiquement à partir des prénoms et du nom, sur 10 lettres maximum. Une modification ultérieure reste possible tous les 30 jours. Le lieu d'inscription est confidentiel et permanent.</p>
          <p>{registered ? "Lieu d'inscription définitivement enregistré." : "Lieu d'inscription à renseigner pour finaliser ton identité."}</p>
          <FormDialog title="Modifier mon profil" buttonLabel="Modifier mon profil">
            <form action={saveProfile} className="form">
              <div className="field"><label htmlFor="profile-full-name">Nom complet</label>
                <input id="profile-full-name" name="full_name" required minLength={2} maxLength={120}
                  autoComplete="name" defaultValue={profile.full_name || ""} />
              </div>
              <div className="field"><label htmlFor="profile-username">Nom d’utilisateur (10 lettres maximum)</label>
                <input id="profile-username" name="username" minLength={2}
                  maxLength={profile.username && !GENERATED_USERNAME_PATTERN.test(profile.username) ? 30 : 10}
                  autoComplete="username"
                  pattern={profile.username && !GENERATED_USERNAME_PATTERN.test(profile.username) ? "[A-Za-z][A-Za-z0-9._]{1,29}" : "[A-Za-z]{2,10}"}
                  defaultValue={profile.username || ""} placeholder="Généré automatiquement" />
                <small>Pour les comptes sans nom d’utilisateur, MAGNISA le génère dès l’enregistrement du profil. Les anciens noms restent valables.</small>
              </div>
              {!registered && (
                <>
                  <div className="field"><label>Pays au moment de l'inscription</label>
                    <input value={REGISTRATION_COUNTRY_NAME} readOnly />
                    <input type="hidden" name="country_code" value={REGISTRATION_COUNTRY_CODE}/>
                  </div>
                  <div className="field"><label htmlFor="profile-locality">Localité au moment de l'inscription</label>
                    <select id="profile-locality" name="locality_code" required defaultValue="">
                      <option value="" disabled>Choisir ma localité</option>
                      {REGISTRATION_LOCALITIES.map(item=><option key={item.code} value={item.code}>{item.name}</option>)}
                    </select>
                  </div>
                </>
              )}
              <button className="button primary" type="submit">Enregistrer mon profil</button>
            </form>
          </FormDialog>
        </section>
      </div>
    </>
  );
}
