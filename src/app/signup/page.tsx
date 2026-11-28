"use client";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signUp } from "@/server/actions/auth";
import { BrandMark } from "@/components/brand-mark";
import type { LocalitySuggestion } from "@/lib/geo/madagascar-localities";
import { REGISTRATION_REGIONS, REGISTRATION_COUNTRY_CODE, REGISTRATION_COUNTRY_NAME, generateUsername, normalizeUsername } from "@/lib/auth/magnisa-identity";

export default function Signup() {
  const router = useRouter();
  const [state, action, pending] = useActionState<any, FormData>(async (_: any, data: FormData) => signUp(data), {});
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phoneCountry, setPhoneCountry] = useState("MG");
  const [phonePrefix, setPhonePrefix] = useState("032");
  const [phoneNational, setPhoneNational] = useState("");
  const [step, setStep] = useState<1 | 2>(1);
  const identityFieldsRef = useRef<HTMLFieldSetElement>(null);
  const [username, setUsername] = useState("");
  const [customized, setCustomized] = useState(false);
  const [region, setRegion] = useState("");
  const [locality, setLocality] = useState("");
  const [localityRef, setLocalityRef] = useState("");
  const [suggestions, setSuggestions] = useState<LocalitySuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    if (!region || locality.trim().length < 2 || localityRef) {
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
  }, [region, locality, localityRef]);
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
          <label htmlFor="signup-first-name">Prénom</label>
          <input id="signup-first-name" name="first_name" required maxLength={60} autoComplete="given-name"
            placeholder="Francky" value={firstName} onChange={e => setFirstName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="signup-last-name">Nom</label>
          <input id="signup-last-name" name="last_name" required maxLength={60} autoComplete="family-name"
            placeholder="Masinjaka" value={lastName} onChange={e => setLastName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="signup-birth-date">Date de naissance</label>
          <input id="signup-birth-date" name="birth_date" type="date" required max={new Date().toISOString().slice(0,10)} autoComplete="bday" />
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
        <div className="field signup-phone-field">
          <label htmlFor="signup-phone-country">Téléphone</label>
          <div className="signup-phone-row">
            <div className="signup-phone-country">
              <span className={phoneCountry === "MG" ? "signup-flag-mg" : "signup-flag-other"} aria-label={phoneCountry === "MG" ? "Drapeau de Madagascar" : "Drapeau du pays sélectionné"}>{phoneCountry === "MG" ? null : String.fromCodePoint(...Array.from(phoneCountry, c => 127397 + c.charCodeAt(0)))}</span>
              <select id="signup-phone-country" name="phone_country" aria-label="Pays et indicatif téléphonique" value={phoneCountry} onChange={e => { setPhoneCountry(e.target.value); setPhonePrefix(e.target.value === "MG" ? "032" : ""); setPhoneNational(""); }} required>
                <option value="MG">Madagascar (+261)</option><option value="FR">France (+33)</option><option value="RE">La Réunion (+262)</option><option value="MU">Maurice (+230)</option><option value="KM">Comores (+269)</option><option value="ZA">Afrique du Sud (+27)</option><option value="SN">Sénégal (+221)</option><option value="KE">Kenya (+254)</option><option value="GB">Royaume-Uni (+44)</option><option value="US">États-Unis (+1)</option><option value="CA">Canada (+1)</option><option value="DE">Allemagne (+49)</option><option value="IT">Italie (+39)</option><option value="ES">Espagne (+34)</option><option value="CH">Suisse (+41)</option><option value="AE">Émirats arabes unis (+971)</option><option value="IN">Inde (+91)</option><option value="CN">Chine (+86)</option><option value="JP">Japon (+81)</option><option value="AU">Australie (+61)</option>
              </select>
            </div>
            <select id="signup-phone-prefix" name="phone_prefix" aria-label="Préfixe opérateur" value={phonePrefix} onChange={e => setPhonePrefix(e.target.value)} required={phoneCountry === "MG"}>
              {phoneCountry === "MG" ? ["032","033","034","035","036","037","038","039"].map(prefix => <option key={prefix} value={prefix}>{prefix}</option>) : <option value="">—</option>}
            </select>
            <input id="signup-phone-national" name="phone_national" type="tel" inputMode="numeric" autoComplete="tel-national" required value={phoneNational} onChange={e => setPhoneNational(e.target.value.replace(/\D/g, "").slice(0, phoneCountry === "MG" ? 7 : 14))} minLength={phoneCountry === "MG" ? 7 : ({FR:9,RE:9,MU:8,KM:7,ZA:9,SN:9,KE:9,GB:10,US:10,CA:10,DE:10,IT:9,ES:9,CH:9,AE:9,IN:10,CN:11,JP:10,AU:9} as Record<string,number>)[phoneCountry] || 7} maxLength={phoneCountry === "MG" ? 7 : ({FR:9,RE:9,MU:8,KM:7,ZA:9,SN:9,KE:9,GB:10,US:10,CA:10,DE:11,IT:10,ES:9,CH:9,AE:9,IN:10,CN:11,JP:10,AU:9} as Record<string,number>)[phoneCountry] || 14} pattern="[0-9]*" placeholder={phoneCountry === "MG" ? "1234567" : "Numéro national"} aria-label={phoneCountry === "MG" ? "Sept chiffres du numéro" : "Numéro national sans indicatif"} />
          </div>
        </div>
        <div className="field signup-field-full">
          <label htmlFor="signup-email">Adresse e-mail personnelle</label>
          <input id="signup-email" name="email" type="email" required autoComplete="email"
            placeholder="prenom@exemple.com" aria-describedby="signup-email-help" />
        </div>
        <div className="field">
          <label htmlFor="signup-country">Pays de résidence</label>
          <input id="signup-country" value={REGISTRATION_COUNTRY_NAME} readOnly />
          <input type="hidden" name="country_code" value={REGISTRATION_COUNTRY_CODE} />
        </div>
        <div className="field">
          <label htmlFor="signup-region">Région de résidence</label>
          <select id="signup-region" name="region_code" required value={region}
            onChange={e => {
              setRegion(e.target.value); setLocality(""); setLocalityRef(""); setSuggestions([]);
            }}>
            <option value="" disabled>Sélectionner une région</option>
            {REGISTRATION_REGIONS.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="signup-locality">Ville, commune, fokontany ou village de résidence</label>
          <input id="signup-locality" name="locality_name" type="text" required minLength={2} maxLength={160}
            autoComplete="address-level2" disabled={!region} value={locality}
            onChange={e => { setLocality(e.target.value); setLocalityRef(""); }}
            placeholder={region ? "Saisir votre localité, même un petit village" : "Choisir d'abord une région"}
            aria-describedby="signup-locality-help" aria-controls="locality-suggestions" />
          <input type="hidden" name="locality_ref" value={localityRef} />
          {searching && <small role="status">Recherche de localités…</small>}
          {!localityRef && suggestions.length > 0 && <div id="locality-suggestions" role="listbox"
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