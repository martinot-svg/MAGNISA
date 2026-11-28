import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/current-org";
import { REGISTRATION_COUNTRY_CODE, REGISTRATION_COUNTRY_NAME, REGISTRATION_REGIONS, NEW_USERNAME_PATTERN, USERNAME_PATTERN, isValidRegistrationRegion, normalizeUsername } from "@/lib/auth/magnisa-identity";
import { FormDialog } from "@/components/form-dialog";
import { SIGNUP_PHONE_COUNTRIES } from "@/lib/auth/phone";

async function saveProfile(formData: FormData) {
  "use server";
  const { supabase, user } = await requireUser();
  const fullName = String(formData.get("full_name") || "").trim();
  const username = normalizeUsername(String(formData.get("username") || ""));
  const region = String(formData.get("region_code") || "");
  const localityName = String(formData.get("locality_name") || "").trim();
  const { data: alreadyRegistered, error: statusError } = await supabase.rpc("has_magnisa_registration");
  if (statusError) throw new Error("Impossible de vérifier le lieu d'inscription.");
  const { data: oldProfile, error: profileError } = await supabase
    .from("profiles").select("username").eq("id", user.id).single();
  if (profileError) throw new Error("Profil indisponible.");
  // Existing legacy handles remain valid unless the owner elects to rename them.
  if (fullName.length < 2 || fullName.length > 120 ||
    (username !== oldProfile?.username && !NEW_USERNAME_PATTERN.test(username))) {
    throw new Error("Le nouveau nom d’utilisateur doit comporter 3 à 10 lettres.");
  }
  if (!alreadyRegistered && (!isValidRegistrationRegion(REGISTRATION_COUNTRY_CODE, region) ||
      localityName.length < 2 || localityName.length > 160)) {
    throw new Error("Région ou localité d'inscription invalide.");
  }
  const { error } = alreadyRegistered
    ? await supabase.rpc("claim_magnisa_identity", {
        p_full_name: fullName, p_username: username, p_country: "", p_locality: "",
      })
    : await supabase.rpc("claim_magnisa_identity_with_location", {
        p_full_name: fullName, p_username: username,
        p_region_code: region, p_locality_name: localityName,
      });
  if (error) {
    if (error.code === "23505") throw new Error("Ce nom d’utilisateur est déjà utilisé.");
    throw new Error(error.message || "Impossible d'enregistrer l'identité MAGNISA.");
  }
  revalidatePath("/mon-profil");
  revalidatePath("/utilisateurs");
}

async function saveResidence(formData: FormData) {
  "use server";
  const { supabase } = await requireUser();
  const countryIso2 = String(formData.get("residence_country_iso2") || "").toUpperCase();
  const country = SIGNUP_PHONE_COUNTRIES.find(item => item.iso2 === countryIso2);
  const countryName = new Intl.DisplayNames(["fr"], { type: "region" }).of(countryIso2) || countryIso2;
  const regionName = String(formData.get("residence_region_name") || "").trim();
  const localityName = String(formData.get("residence_locality_name") || "").trim();
  if (!country || regionName.length < 1 || regionName.length > 120 ||
      localityName.length < 2 || localityName.length > 160) {
    throw new Error("Pays, région ou localité de résidence invalide.");
  }
  const { error } = await supabase.rpc("update_magnisa_user_residence", {
    p_country_iso2: countryIso2,
    p_country_name: countryName,
    p_region_name: regionName,
    p_locality_name: localityName,
    p_locality_ref: null,
  });
  if (error) throw new Error("Impossible d'enregistrer votre résidence.");
  revalidatePath("/mon-profil");
}

export default async function MyMagnisaProfile() {
  const { supabase, user } = await requireUser();
  const [{ data: profile, error }, { data: registered, error: registrationError }, { data: residenceRows, error: residenceError }] = await Promise.all([
    supabase.from("profiles").select("email,full_name,username,public_id,username_changed_at")
      .eq("id",user.id).maybeSingle(),
    supabase.rpc("has_magnisa_registration"),
    supabase.rpc("get_magnisa_user_residence"),
  ]);
  if (error || !profile) throw new Error("Profil indisponible.");
  if (registrationError) throw new Error("Impossible de vérifier le lieu d'inscription.");
  if (residenceError) throw new Error("Impossible de charger les informations de résidence.");
  const residence = Array.isArray(residenceRows) ? residenceRows[0] : null;
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
              <div className="field"><label htmlFor="profile-username">Nom d’utilisateur (@)</label>
                <input id="profile-username" name="username" required minLength={3} maxLength={30}
                  autoComplete="username" pattern={USERNAME_PATTERN.source.slice(1,-1)}
                  defaultValue={profile.username || ""} placeholder="Généré automatiquement" />
                <small>Tout nouveau nom doit comporter 3 à 10 lettres minuscules. Le préfixe @ est ajouté automatiquement. Les anciens noms restent valables.</small>
              </div>
              {!registered && (
                <>
                  <div className="field"><label>Pays au moment de l'inscription</label>
                    <input value={REGISTRATION_COUNTRY_NAME} readOnly />
                    <input type="hidden" name="country_code" value={REGISTRATION_COUNTRY_CODE}/>
                  </div>
                  <div className="field"><label htmlFor="profile-region">Région d'inscription</label>
                    <select id="profile-region" name="region_code" required defaultValue="">
                      <option value="" disabled>Sélectionner une région</option>
                      {REGISTRATION_REGIONS.map(item=><option key={item.code} value={item.code}>{item.name}</option>)}
                    </select>
                  </div>
                  <div className="field"><label htmlFor="profile-locality">Ville, commune, fokontany ou village d'inscription</label>
                    <input id="profile-locality" name="locality_name" required minLength={2}
                      maxLength={160} placeholder="Saisir votre localité exacte" />
                    <small>Vous pouvez saisir librement une localité absente de la liste nationale.</small>
                  </div>
                </>
              )}
              <button className="button primary" type="submit">Enregistrer mon profil</button>
            </form>
          </FormDialog>
        </section>
      </div>
      <section className="card">
        <h2>Ma résidence</h2>
        <p className="muted">Ces informations sont indépendantes du lieu d'inscription permanent et peuvent être modifiées à tout moment.</p>
        {residence ? (
          <p><strong>{residence.locality_name}</strong>, {residence.region_name}, {residence.country_name}</p>
        ) : <p className="muted">Aucune résidence enregistrée.</p>}
        <FormDialog title="Modifier ma résidence" buttonLabel={residence ? "Modifier ma résidence" : "Renseigner ma résidence"}>
          <form action={saveResidence} className="form">
            <div className="field">
              <label htmlFor="residence-country-edit">Pays de résidence</label>
              <select id="residence-country-edit" name="residence_country_iso2" required defaultValue={residence?.country_iso2 || "MG"}>
                {SIGNUP_PHONE_COUNTRIES.map(item => <option key={item.iso2} value={item.iso2}>
                  {new Intl.DisplayNames(["fr"], { type: "region" }).of(item.iso2) || item.iso2}
                </option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="residence-region-edit">Région / Province / État</label>
              <input id="residence-region-edit" name="residence_region_name" required minLength={1} maxLength={120}
                defaultValue={residence?.region_name || ""} />
            </div>
            <div className="field">
              <label htmlFor="residence-locality-edit">Ville / Localité</label>
              <input id="residence-locality-edit" name="residence_locality_name" required minLength={2} maxLength={160}
                defaultValue={residence?.locality_name || ""} />
            </div>
            <button className="button primary" type="submit">Enregistrer ma résidence</button>
          </form>
        </FormDialog>
      </section>
    </>
  );
}
