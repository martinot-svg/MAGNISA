"use client";

import { useState } from "react";
import { smiePartners } from "@/lib/payroll/smie-partners";

type Props = { defaultName?: string | null; defaultContact?: string | null };

function parseContact(value: string) {
  const lines = value.split("\n");
  const get = (label: string) => lines.find((line) => line.startsWith(label))?.slice(label.length).trim() ?? "";
  return {
    address: get("Adresse :"),
    phone: get("Téléphone :"),
    email: get("E-mail :"),
    city: get("Ville :"),
  };
}

export function SmiePartnerFields({ defaultName = "", defaultContact = "" }: Props) {
  const initial = parseContact(defaultContact ?? "");
  const initialPartner = smiePartners.find((item) => item.name === (defaultName ?? "") && item.city === initial.city);
  const [name, setName] = useState(defaultName ?? "");
  const [address, setAddress] = useState(initial.address);
  const [phone, setPhone] = useState(initial.phone);
  const [email, setEmail] = useState(initial.email);
  const [selectedId, setSelectedId] = useState(initialPartner?.id ?? "");
  const [sourceNote, setSourceNote] = useState(initialPartner?.sourceNote ?? "");
  const [sourceUrl, setSourceUrl] = useState(initialPartner?.sourceUrl ?? "");
  const [verification, setVerification] = useState(initialPartner?.verification ?? "location-only");

  function selectPartner(id: string) {
    setSelectedId(id);
    const partner = smiePartners.find((item) => item.id === id);
    if (!partner) {
      setSourceNote("");
      setSourceUrl("");
      setVerification("location-only");
      if (id === "__custom" || id === "") {
        setName("");
        setAddress("");
        setPhone("");
        setEmail("");
      }
      return;
    }
    setName(partner.name);
    setAddress(partner.address);
    setPhone(partner.phone);
    setEmail(partner.email);
    setSourceNote(partner.sourceNote);
    setSourceUrl(partner.sourceUrl);
    setVerification(partner.verification);
  }

  const contact = [
    `Adresse : ${address}`,
    `Téléphone : ${phone}`,
    `E-mail : ${email}`,
    `Ville : ${smiePartners.find((item) => item.id === selectedId)?.city ?? initial.city}`,
  ].join("\n");

  return <>
    <div className="field">
      <label htmlFor="smie_partner_choice">SMIE partenaire de l'entreprise</label>
      <select id="smie_partner_choice" value={selectedId} onChange={(event) => selectPartner(event.target.value)}>
        <option value="">Sélectionner un SMIE recensé</option>
        {smiePartners.map((partner) => <option key={partner.id} value={partner.id}>{partner.name} - {partner.city}</option>)}
        <option value="__custom">Autre organisme / saisie libre</option>
      </select>
      <label htmlFor="smie_partner_name_manual">Dénomination du partenaire</label>
      <input id="smie_partner_name_manual" value={name} onChange={(event) => { setName(event.target.value); setSelectedId(""); setSourceNote(""); setSourceUrl(""); setVerification("location-only"); }} maxLength={160} placeholder="Nom officiel du SMIE" />
      <input type="hidden" name="smie_partner_name" value={name} />
      {sourceNote ? <p className="muted">Fiabilité : {verification === "official" ? "site officiel" : verification === "institutional" ? "source institutionnelle" : verification === "directory" ? "annuaire professionnel" : verification === "historical" ? "source historique" : "localisation uniquement"}. Source : {sourceNote}. {sourceUrl ? <a href={sourceUrl} target="_blank" rel="noreferrer">Consulter la source</a> : null} Vérifie les informations auprès de l'organisme avant une première affiliation.</p> : <p className="muted">Les coordonnées non publiées ou non recoupées restent vides. Tu peux les compléter manuellement.</p>}
    </div>
    <div className="field">
      <label htmlFor="smie_address">Coordonnées de la SMIE - Adresse</label>
      <textarea id="smie_address" value={address} onChange={(event) => setAddress(event.target.value)} rows={2} maxLength={250} placeholder="Adresse physique de l'organisme" />
    </div>
    <div className="grid2">
      <div className="field"><label htmlFor="smie_phone">Téléphone</label><input id="smie_phone" value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={50} placeholder="Téléphone" /></div>
      <div className="field"><label htmlFor="smie_email">E-mail</label><input id="smie_email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={100} placeholder="Adresse e-mail" /></div>
    </div>
    <textarea name="smie_partner_contact" value={contact} readOnly hidden maxLength={500} aria-hidden="true" />
  </>;
}
