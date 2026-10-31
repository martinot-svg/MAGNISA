"use client";

import { useMemo, useState } from "react";

type Institution = {
  id: string;
  display_name: string;
  category: "bank" | "microfinance" | "financial_institution" | "individual_company" | "other";
  organization_id: string | null;
  verification_status: string;
};

type InstitutionLocation = {
  id: string;
  institution_id: string;
  branch_name: string;
  city: string;
  region: string | null;
  address: string | null;
  verification_status: string;
};

const categories = [
  { value: "bank", label: "Banque commerciale" },
  { value: "microfinance", label: "Institution de microfinance" },
  { value: "financial_institution", label: "Établissement financier" },
  { value: "individual_company", label: "Personne physique ou entreprise" },
  { value: "other", label: "Autre organisme prêteur" },
] as const;

export function LenderSelector({
  institutions,
  locations,
}: {
  institutions: Institution[];
  locations: InstitutionLocation[];
}) {
  const [category, setCategory] = useState<Institution["category"] | "">("");
  const [institutionId, setInstitutionId] = useState("");
  const [customMode, setCustomMode] = useState(false);
  const [customName, setCustomName] = useState("");
  const [city, setCity] = useState("");
  const [locationId, setLocationId] = useState("");
  const [manualBranch, setManualBranch] = useState("");
  const [manualRegion, setManualRegion] = useState("");
  const [manualAddress, setManualAddress] = useState("");

  const options = useMemo(
    () => institutions.filter((item) => item.category === category),
    [institutions, category],
  );
  const selected = options.find((item) => item.id === institutionId);
  const isCustom = customMode || category === "individual_company" || category === "other" ||
    (category === "financial_institution" && options.length === 0);
  const availableLocations = useMemo(
    () => locations.filter((item) =>
      (!institutionId || item.institution_id === institutionId) &&
      item.city.toLocaleLowerCase("fr") === city.trim().toLocaleLowerCase("fr")
    ),
    [locations, institutionId, city],
  );
  const selectedLocation = availableLocations.find((item) => item.id === locationId);
  const citySuggestions = useMemo(
    () => Array.from(new Set(locations
      .filter((item) => !institutionId || item.institution_id === institutionId)
      .map((item) => item.city))).sort((a, b) => a.localeCompare(b, "fr")),
    [locations, institutionId],
  );
  const lenderName = isCustom ? customName.trim() : selected?.display_name || "";

  function changeCategory(value: string) {
    setCategory(value as Institution["category"]);
    setInstitutionId("");
    setCustomMode(value === "individual_company" || value === "other");
    setCustomName("");
    setCity("");
    setLocationId("");
    setManualBranch("");
    setManualRegion("");
    setManualAddress("");
  }

  function changeInstitution(value: string) {
    if (value === "__new__") {
      setInstitutionId("");
      setCustomMode(true);
      setCustomName("");
    } else {
      setInstitutionId(value);
      setCustomMode(false);
      setCustomName("");
    }
    setCity("");
    setLocationId("");
    setManualBranch("");
    setManualRegion("");
    setManualAddress("");
  }

  function changeCity(value: string) {
    setCity(value);
    setLocationId("");
    setManualBranch("");
    setManualRegion("");
    setManualAddress("");
  }

  function changeLocation(value: string) {
    setLocationId(value === "__manual__" ? "" : value);
    setManualBranch("");
    setManualRegion("");
    setManualAddress("");
  }

  return (
    <div className="field">
      <label htmlFor="lender_category_selector">Catégorie du prêteur</label>
      <select id="lender_category_selector" value={category} onChange={(event) => changeCategory(event.target.value)} required>
        <option value="" disabled>Choisir une catégorie</option>
        {categories.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
      </select>

      {category && !isCustom && (
        <>
          <label htmlFor="financial_institution_selector">Prêteur</label>
          <select id="financial_institution_selector" value={institutionId} onChange={(event) => changeInstitution(event.target.value)} required>
            <option value="" disabled>{options.length ? "Choisir dans la liste" : "Aucun établissement préenregistré"}</option>
            {options.map((item) => <option key={item.id} value={item.id}>{item.display_name}</option>)}
            <option value="__new__">＋ Ajouter un prêteur non répertorié</option>
          </select>
        </>
      )}

      {category && isCustom && (
        <>
          <label htmlFor="custom_lender_name">Nom du prêteur</label>
          <input id="custom_lender_name" value={customName} onChange={(event) => setCustomName(event.target.value)} placeholder="Saisir la dénomination du prêteur" maxLength={160} required />
          {category !== "individual_company" && category !== "other" && (
            <button type="button" className="button secondary" onClick={() => {
              setCustomMode(false);
              setCustomName("");
              setInstitutionId("");
            }}>Retour à la liste</button>
          )}
          <p className="muted">Ce prêteur sera ajouté au référentiel de ton organisation lors de l'enregistrement de l'emprunt.</p>
        </>
      )}

      {category && (
        <div className="section">
          <p className="eyebrow">Localisation du prêteur</p>
          <label htmlFor="lender_city">Ville d'implantation</label>
          <input id="lender_city" list="lender_city_suggestions" value={city} onChange={(event) => changeCity(event.target.value)} placeholder="Ex. Antananarivo, Toliara, Toamasina..." maxLength={100} required />
          <datalist id="lender_city_suggestions">
            {citySuggestions.map((item) => <option key={item} value={item} />)}
          </datalist>

          {!isCustom && institutionId && availableLocations.length > 0 && (
            <>
              <label htmlFor="lender_location_selector">Agence / établissement</label>
              <select id="lender_location_selector" value={locationId || "__manual__"} onChange={(event) => changeLocation(event.target.value)}>
                <option value="__manual__">Agence non répertoriée / saisie manuelle</option>
                {availableLocations.map((item) => <option key={item.id} value={item.id}>{item.branch_name}</option>)}
              </select>
            </>
          )}

          {selectedLocation ? (
            <div className="muted">
              <p><strong>{selectedLocation.branch_name}</strong></p>
              <p>{[selectedLocation.region, selectedLocation.address].filter(Boolean).join(" · ") || "Adresse non renseignée dans le référentiel"}</p>
              <p>Agence issue du référentiel MAGNISA. Vérifie les informations sur le contrat.</p>
            </div>
          ) : (
            <>
              <label htmlFor="lender_branch_name">Nom de l'agence (facultatif)</label>
              <input id="lender_branch_name" value={manualBranch} onChange={(event) => setManualBranch(event.target.value)} placeholder="Ex. Agence Analakely" maxLength={160} />
              <label htmlFor="lender_region">Région (facultatif)</label>
              <input id="lender_region" value={manualRegion} onChange={(event) => setManualRegion(event.target.value)} placeholder="Ex. Analamanga" maxLength={100} />
              <label htmlFor="lender_address">Adresse (facultatif)</label>
              <input id="lender_address" value={manualAddress} onChange={(event) => setManualAddress(event.target.value)} placeholder="Adresse ou quartier de l'agence" maxLength={240} />
            </>
          )}
        </div>
      )}

      <input type="hidden" name="lender_name" value={lenderName} />
      <input type="hidden" name="lender_category" value={category} />
      <input type="hidden" name="financial_institution_id" value={selected && !isCustom ? selected.id : ""} />
      <input type="hidden" name="register_new_lender" value={isCustom ? "true" : "false"} />
      <input type="hidden" name="lender_location_id" value={selectedLocation?.id || ""} />
      <input type="hidden" name="lender_city" value={city.trim()} />
      <input type="hidden" name="lender_region" value={selectedLocation?.region || manualRegion.trim()} />
      <input type="hidden" name="lender_branch_name" value={selectedLocation?.branch_name || manualBranch.trim()} />
      <input type="hidden" name="lender_address" value={selectedLocation?.address || manualAddress.trim()} />
      {selected?.verification_status === "reference" && <p className="muted">Entrée de référence : vérifie la dénomination exacte sur le contrat de prêt.</p>}
    </div>
  );
}
