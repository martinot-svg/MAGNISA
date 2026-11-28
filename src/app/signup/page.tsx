"use client";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signUp } from "@/server/actions/auth";
import { BrandMark } from "@/components/brand-mark";
import type { LocalitySuggestion } from "@/lib/geo/madagascar-localities";
import { REGISTRATION_REGIONS, generateUsername, normalizeUsername } from "@/lib/auth/magnisa-identity";
import { getSignupPhoneDialCode, getSignupPhoneCountry, SIGNUP_PHONE_COUNTRIES } from "@/lib/auth/phone";

export default function Signup() {
  const router = useRouter();
  const [state, action, pending] = useActionState<any, FormData>(async (_: any, data: FormData) => signUp(data), {});
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phoneCountry, setPhoneCountry] = useState("MG");
  const [phonePrefix, setPhonePrefix] = useState("032");
  const [phoneNational, setPhoneNational] = useState("");
  const [phoneCountryQuery, setPhoneCountryQuery] = useState("");
  const [step, setStep] = useState<1 | 2>(1);
  const identityFieldsRef = useRef<HTMLFieldSetElement>(null);
  const [username, setUsername] = useState("");
  const [customized, setCustomized] = useState(false);
  const [residenceCountry, setResidenceCountry] = useState("MG");
  const [residenceCountryQuery, setResidenceCountryQuery] = useState("");
  const [region, setRegion] = useState("");
  const [locality, setLocality] = useState("");
  const [localityRef, setLocalityRef] = useState("");
  const [suggestions, setSuggestions] = useState<LocalitySuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const phoneCountryNames = new Intl.DisplayNames(["fr"], { type: "region" });
  const residenceCountryNames = new Intl.DisplayNames(["fr"], { type: "region" });
  const phoneCountryOptions = SIGNUP_PHONE_COUNTRIES.map(item => ({
    ...item,
    name: phoneCountryNames.of(item.iso2) || item.iso2,
    flag: item.iso2 === "MG" ? "🇲🇬" : String.fromCodePoint(...Array.from(item.iso2, c => 127397 + c.charCodeAt(0))),
  })).sort((a, b) => a.iso2 === "MG" ? -1 : b.iso2 === "MG" ? 1 : a.name.localeCompare(b.name, "fr"));
  const countryQuery = phoneCountryQuery.trim().toLocaleLowerCase("fr");
  const countryQueryDigits = countryQuery.replace(/\D/g, "");
  const filteredPhoneCountries = phoneCountryOptions.filter(item =>
    !countryQuery || item.name.toLocaleLowerCase("fr").includes(countryQuery) ||
    item.iso2.toLowerCase().includes(countryQuery) ||
    (countryQueryDigits.length > 0 && item.dialCode.includes(countryQueryDigits)) || ("+" + item.dialCode).includes(countryQuery)
  );
  const residenceQuery = residenceCountryQuery.trim().toLocaleLowerCase("fr");
  const filteredResidenceCountries = phoneCountryOptions.filter(item =>
    !residenceQuery || item.name.toLocaleLowerCase("fr").includes(residenceQuery) ||
    item.iso2.toLowerCase().includes(residenceQuery)
  );
  const selectedResidenceCountryName = residenceCountryNames.of(residenceCountry) || residenceCountry;
  const selectedResidenceRegionName = residenceCountry === "MG"
    ? REGISTRATION_REGIONS.find(item => item.code === region)?.name || ""
    : region.trim();
  const selectedPhoneCountry = getSignupPhoneCountry(phoneCountry);
  const nationalLengthOptions = selectedPhoneCountry?.mobileLengths || [];
  const nationalMinLength = phoneCountry === "MG" ? 7 : nationalLengthOptions.length ? Math.min(...nationalLengthOptions) : 4;
  const nationalMaxLength = phoneCountry === "MG" ? 7 : nationalLengthOptions.length ? Math.max(...nationalLengthOptions) : 14;
  useEffect(() => {
    if (residenceCountry !== "MG" || !region || locality.trim().length < 2 || localityRef) {
      setSuggestions([]);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    const timeout = setTimeout(() => {
      const q = new URLSearchParams({ region, q: locality.trim() });
      fetch(`/api/localities/suggest?${q}`, { signal: controller.signal })
        .then(response => response.ok ? response.json() : { results: [] as LocalitySuggestion[] })
        .then(payload => { if (!controller.signal.aborted) setSuggestions(payload.results || []); })
        .catch(() => { if (!controller.signal.aborted) setSuggestions([]); })
        .finally(() => { if (!controller.signal.aborted) setSearching(false); });
    }, 200);
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [residenceCountry, region, locality, localityRef]);
  useEffect(() => {
    if (state?.email) router.push(`/verify-email?email=${encodeURIComponent(state.email)}`);
  }, [state, router]);
  useEffect(() => {
    if (!customized) setUsername(generateUsername(firstName, lastName));
  }, [firstName, lastName, customized]);

  return (
    <main className="auth authPremium">
      <BrandMark />
      <div>
        <p className="eyebrow">{step === 1 ? "Étape 1 sur 2 · Vos informations" : "Étape 2 sur 2 · Sécuriser votre compte"}</p>
        <h1>{step === 1 ? "Bienvenue sur MAGNISA" : "Sécuriser votre compte"}</h1>
        <p className="muted">{step === 1
          ? "Créez votre compte personnel unique. Vos informations d'inscription restent confidentielles."
          : "Choisissez un mot de passe d'au moins 10 caractères pour protéger votre compte."}</p>
      </div>
      <form action={action} className="form" onSubmit={event => {
        if (step === 1) {
          event.preventDefault();
          const invalidField = identityFieldsRef.current?.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(":invalid");
          if (invalidField) invalidField.reportValidity();
          else setStep(2);
        }
      }}>
        <fieldset ref={identityFieldsRef} hidden={step !== 1} style={{border:0,padding:0,margin:0,minWidth:0}}>
        <div className="signup-grid">
        <div className="field">
          <label htmlFor="signup-last-name">Nom</label>
          <input id="signup-last-name" name="last_name" required maxLength={60} autoComplete="family-name"
            placeholder="Masinjaka" value={lastName} onChange={e => setLastName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="signup-first-name">Prénoms</label>
          <input id="signup-first-name" name="first_name" required maxLength={60} autoComplete="given-name"
            placeholder="Francky" value={firstName} onChange={e => setFirstName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="signup-username">Nom d'utilisateur MAGNISA</label>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span aria-hidden="true" style={{ fontWeight:700 }}>@</span>
            <input id="signup-username" name="username" required minLength={3} maxLength={10}
              pattern="[a-z]{3,10}" autoCapitalize="none" autoComplete="username" spellCheck={false}
              placeholder="nomutilisateur" aria-describedby="username-help" value={username}
              onChange={e => {
                const clean = normalizeUsername(e.target.value).normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z]/g,"").slice(0,10);
                setCustomized(true);
                setUsername(clean);
              }}
              style={{ width:"100%" }} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="signup-birth-date">Date de naissance</label>
          <input id="signup-birth-date" name="birth_date" type="date" required max={new Date().toISOString().slice(0,10)} autoComplete="bday" />
        </div>
        <div className="field signup-phone-field">
          <label htmlFor="signup-phone-country">Téléphone</label>
          <div className="signup-phone-row">
            <div className="signup-phone-country">
              <span className={phoneCountry === "MG" ? "signup-flag-mg" : "signup-flag-other"} aria-label={phoneCountry === "MG" ? "Drapeau de Madagascar" : "Drapeau du pays sélectionné"}>{phoneCountry === "MG" ? null : String.fromCodePoint(...Array.from(phoneCountry, c => 127397 + c.charCodeAt(0)))}</span>
              <div className="signup-phone-country-controls">
                <input id="signup-phone-country-search" type="search" aria-label="Rechercher un pays ou un indicatif" placeholder="Rechercher un pays ou +…" value={phoneCountryQuery} onChange={e => setPhoneCountryQuery(e.target.value)} />
                <select id="signup-phone-country" name="phone_country" aria-label="Pays du numéro de téléphone" value={phoneCountry} onChange={e => { setPhoneCountry(e.target.value); setPhonePrefix(e.target.value === "MG" ? "032" : ""); setPhoneNational(""); }} required>
                  {filteredPhoneCountries.length ? filteredPhoneCountries.map(item => <option key={item.iso2} value={item.iso2}>{item.flag} {item.name} (+{item.dialCode})</option>) : <option value={phoneCountry}>{phoneCountry} — aucun résultat</option>}
                </select>
              </div>
            </div>
            <div className="signup-phone-dial-code">
              <span className="signup-phone-field-label">Indicatif</span>
              <output aria-live="polite" aria-label="Indicatif international">+{getSignupPhoneDialCode(phoneCountry)}</output>
            </div>
            <div className="signup-phone-prefix">
            <span className="signup-phone-field-label">Préfixe</span>
            <select id="signup-phone-prefix" name="phone_prefix" aria-label="Préfixe mobile" value={phonePrefix} onChange={e => setPhonePrefix(e.target.value)} required={phoneCountry === "MG"} disabled={phoneCountry !== "MG"}>
              {phoneCountry === "MG" ? ["032","033","034","035","036","037","038","039"].map(prefix => <option key={prefix} value={prefix}>{prefix}</option>) : <option value="">—</option>}
            </select>
            </div>
            <div className="signup-phone-national">
            <span className="signup-phone-field-label">Numéro</span>
            <input id="signup-phone-national" name="phone_national" type="tel" inputMode="numeric" autoComplete="tel-national" required disabled={!selectedPhoneCountry?.mobilePattern} value={phoneNational} onChange={e => setPhoneNational(e.target.value.replace(/\D/g, "").slice(0, nationalMaxLength))} minLength={nationalMinLength} maxLength={nationalMaxLength} pattern="[0-9]*" placeholder={phoneCountry === "MG" ? "1234567" : "Numéro national"} aria-label={phoneCountry === "MG" ? "Sept chiffres du numéro" : "Numéro national sans indicatif"} />
            </div>
          </div>
          {!selectedPhoneCountry?.mobilePattern && <small role="status">Les règles de numérotation mobile ne sont pas publiées pour ce territoire dans le référentiel actuel.</small>}
        </div>
        <div className="signup-residence-grid">
        <div className="field">
          <label htmlFor="signup-residence-country">Pays de résidence</label>
          <input type="search" aria-label="Rechercher un pays de résidence" placeholder="Rechercher un pays…"
            value={residenceCountryQuery} onChange={e => setResidenceCountryQuery(e.target.value)} />
          <select id="signup-residence-country" name="residence_country_iso2" required value={residenceCountry}
            onChange={e => {
              setResidenceCountry(e.target.value); setRegion(""); setLocality(""); setLocalityRef("");
              setSuggestions([]); setResidenceCountryQuery("");
            }}>
            {filteredResidenceCountries.map(item => <option key={item.iso2} value={item.iso2}>{item.flag} {item.name}</option>)}
            {!filteredResidenceCountries.some(item => item.iso2 === residenceCountry) &&
              <option value={residenceCountry}>{residenceCountryNames.of(residenceCountry) || residenceCountry}</option>}
          </select>
          <input type="hidden" name="residence_country_name" value={selectedResidenceCountryName} />
        </div>
        <div className="field">
          <label htmlFor="signup-region">Région / Province / État de résidence</label>
          {residenceCountry === "MG" ? (
            <select id="signup-region" name="residence_region_code" required value={region}
              onChange={e => {
                setRegion(e.target.value); setLocality(""); setLocalityRef(""); setSuggestions([]);
              }}>
              <option value="" disabled>Sélectionner une région</option>
              {REGISTRATION_REGIONS.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}
            </select>
          ) : (
            <input id="signup-region" name="residence_region_name" required minLength={1} maxLength={120}
              autoComplete="address-level1" value={region} onChange={e => setRegion(e.target.value)}
              placeholder="Saisir votre région, province ou État" />
          )}
          {residenceCountry === "MG" && <input type="hidden" name="residence_region_name" value={selectedResidenceRegionName} />}
        </div>
        <div className="field">
          <label htmlFor="signup-locality">Ville / Commune / Localité de résidence</label>
          <input id="signup-locality" name="residence_locality_name" type="text" required minLength={2} maxLength={160}
            autoComplete="address-level2" disabled={!region} value={locality}
            onChange={e => { setLocality(e.target.value); setLocalityRef(""); }}
            placeholder={region ? "Saisir votre ville ou localité" : "Indiquer d'abord la région"}
            aria-describedby="signup-locality-help" aria-controls="locality-suggestions" />
          <input type="hidden" name="residence_locality_ref" value={localityRef} />
          {searching && <small role="status">Recherche de localités…</small>}
          {residenceCountry === "MG" && !localityRef && suggestions.length > 0 && <div id="locality-suggestions" role="listbox"
            aria-label="Localités suggérées" style={{ border:"1px solid var(--border, #ddd)", borderRadius:8, maxHeight:240, overflowY:"auto" }}>
            {suggestions.map(item => <button type="button" role="option" aria-selected={false}
              key={item.ref} onClick={() => {
                setLocality(item.name); setLocalityRef(item.ref); setSuggestions([]);
              }} style={{ display:"block", width:"100%", textAlign:"left", padding:10, border:0,
                borderBottom:"1px solid var(--border, #eee)", background:"transparent", cursor:"pointer" }}>
              <strong>{item.name}</strong>
              <span style={{ display:"block", fontSize:12 }}>
                {item.type === "commune" ? "Commune" : "Fokontany"} · {item.commune} · District de {item.district}
              </span>
            </button>)}
          </div>}
        </div>
        </div>
        <div className="field signup-field-full">
          <label htmlFor="signup-email">Adresse e-mail personnelle</label>
          <input id="signup-email" name="email" type="email" required autoComplete="email"
            placeholder="prenom@exemple.com" aria-describedby="signup-email-help" />
        </div>
        <div className="field signup-field-full">
          <label className="signup-majority-label"><input type="checkbox" name="majority_confirmed" value="true" required /> Je confirme que les informations fournies sont exactes et que j’ai au moins 18 ans.</label>
        </div>
        </div>
        </fieldset>
        <fieldset hidden={step !== 2} style={{border:0,padding:0,margin:0,minWidth:0}}>
        <div className="field">
          <label htmlFor="signup-password">Mot de passe</label>
          <input id="signup-password" name="password" type="password" minLength={10} required autoComplete="new-password" />
        </div>
        <div className="field">
          <label htmlFor="signup-password-confirm">Confirmer le mot de passe</label>
          <input id="signup-password-confirm" name="confirm_password" type="password" minLength={10} required autoComplete="new-password" />
        </div>
        </fieldset>
        {state?.error && <p role="alert" className="error">{state.error}</p>}
        {Array.isArray(state?.suggestions) && state.suggestions.length > 0 &&
          <div className="field" aria-label="Autres noms d'utilisateur disponibles">
            <small>Choisissez une variante pour continuer :</small>
            <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
              {state.suggestions.map((suggestion: string) =>
                <button key={suggestion} type="button" className="button"
                  onClick={() => { setCustomized(true); setUsername(suggestion); }}>
                  @{suggestion}
                </button>)}
            </div>
          </div>}
        {step === 1 ? (
          <button className="button primary" type="button" onClick={() => {
            const invalidField = identityFieldsRef.current?.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(":invalid");
            if (invalidField) invalidField.reportValidity();
            else setStep(2);
          }}>Continuer</button>
        ) : (
          <>
            <button className="button" type="button" onClick={() => setStep(1)}>Retour</button>
            <button className="button primary" type="submit" disabled={pending}>
              {pending ? "Création…" : "Créer mon compte personnel"}
            </button>
          </>
        )}
      </form>
      <p className="muted"><Link href="/login">J'ai déjà un compte</Link></p>
    </main>
  );
}