"use client";

import { useMemo, useState } from "react";

type Institution = {
  id: string;
  display_name: string;
  category: "bank" | "microfinance" | "financial_institution" | "individual_company" | "other";
  organization_id: string | null;
  verification_status: string;
};

const categories = [
  { value: "bank", label: "Banque commerciale" },
  { value: "microfinance", label: "Institution de microfinance" },
  { value: "financial_institution", label: "Établissement financier" },
  { value: "individual_company", label: "Personne physique ou entreprise" },
  { value: "other", label: "Autre organisme prêteur" },
] as const;

export function LenderSelector({ institutions }: { institutions: Institution[] }) {
  const [category, setCategory] = useState<Institution["category"] | "">("");
  const [institutionId, setInstitutionId] = useState("");
  const [customMode, setCustomMode] = useState(false);
  const [customName, setCustomName] = useState("");

  const options = useMemo(
    () => institutions.filter((item) => item.category === category),
    [institutions, category],
  );
  const selected = options.find((item) => item.id === institutionId);
  const isCustom = customMode || category === "individual_company" || category === "other" ||
    (category === "financial_institution" && options.length === 0);

  function changeCategory(value: string) {
    setCategory(value as Institution["category"]);
    setInstitutionId("");
    setCustomMode(value === "individual_company" || value === "other");
    setCustomName("");
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
  }

  const lenderName = isCustom ? customName.trim() : selected?.display_name || "";

  return (
    <div className="field">
      <label htmlFor="lender_category_selector">Catégorie du prêteur</label>
      <select
        id="lender_category_selector"
        value={category}
        onChange={(event) => changeCategory(event.target.value)}
        required
      >
        <option value="" disabled>Choisir une catégorie</option>
        {categories.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
      </select>

      {category && !isCustom && (
        <>
          <label htmlFor="financial_institution_selector">Prêteur</label>
          <select
            id="financial_institution_selector"
            value={institutionId}
            onChange={(event) => changeInstitution(event.target.value)}
            required
          >
            <option value="" disabled>
              {options.length ? "Choisir dans la liste" : "Aucun établissement préenregistré"}
            </option>
            {options.map((item) => (
              <option key={item.id} value={item.id}>{item.display_name}</option>
            ))}
            <option value="__new__">＋ Ajouter un prêteur non répertorié</option>
          </select>
        </>
      )}

      {category && isCustom && (
        <>
          <label htmlFor="custom_lender_name">Nom du prêteur</label>
          <input
            id="custom_lender_name"
            value={customName}
            onChange={(event) => setCustomName(event.target.value)}
            placeholder="Saisir la dénomination du prêteur"
            maxLength={160}
            required
          />
          {category !== "individual_company" && category !== "other" && (
            <button type="button" className="button secondary" onClick={() => {
              setCustomMode(false);
              setCustomName("");
              setInstitutionId("");
            }}>
              Retour à la liste
            </button>
          )}
          <p className="muted">Ce prêteur sera ajouté au référentiel de ton organisation lors de l'enregistrement de l'emprunt.</p>
        </>
      )}

      <input type="hidden" name="lender_name" value={lenderName} />
      <input type="hidden" name="lender_category" value={category} />
      <input type="hidden" name="financial_institution_id" value={selected && !isCustom ? selected.id : ""} />
      <input type="hidden" name="register_new_lender" value={isCustom ? "true" : "false"} />
      {selected?.verification_status === "reference" && (
        <p className="muted">Entrée de référence : vérifie la dénomination exacte sur le contrat de prêt.</p>
      )}
    </div>
  );
}
