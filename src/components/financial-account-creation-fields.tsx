"use client";

import { useState } from "react";

export function FinancialAccountCreationFields() {
  const [type, setType] = useState("bank");
  const [operator, setOperator] = useState("");
  return (
    <>
      <div className="field">
        <label htmlFor="treasury-account-type">Type de compte</label>
        <select
          id="treasury-account-type"
          name="type"
          value={type}
          onChange={(event) => {
            setType(event.target.value);
            setOperator("");
          }}
          required
        >
          <option value="bank">Banque</option>
          <option value="cash">Caisse</option>
          <option value="mobile_money">Mobile Money</option>
          <option value="cheque_clearing">Chèques à encaisser</option>
        </select>
      </div>
      {type === "mobile_money" && (
        <div className="field">
          <label htmlFor="treasury-mobile-operator">Opérateur</label>
          <select id="treasury-mobile-operator" name="mobile_operator" value={operator} onChange={(event) => setOperator(event.target.value)} required>
            <option value="">Sélectionner</option>
            <option value="mvola">MVola</option>
            <option value="other">Autre opérateur</option>
          </select>
        </div>
      )}
      {type === "mobile_money" && operator === "mvola" && (
        <div className="field">
          <label htmlFor="treasury-mvola-category">Type de compte MVola</label>
          <select id="treasury-mvola-category" name="mvola_category" defaultValue="" required>
            <option value="">Sélectionner</option>
            <option value="personal">Compte MVola Particulier classique</option>
            <option value="business">Compte MVola Entreprise</option>
            <option value="merchant">Compte Marchand MVola</option>
          </select>
        </div>
      )}
    </>
  );
}
