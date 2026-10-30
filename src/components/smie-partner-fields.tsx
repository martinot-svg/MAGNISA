"use client";

import { useState } from "react";
import { smiePartners } from "@/lib/payroll/smie-partners";

type Props = { defaultName?: string | null; defaultContact?: string | null };

function parseContact(value: string) {
  const lines = value.split("\n");
  const get = (label: string) => lines.find((line) => line.startsWith(label))?.slice(label.length).trim() ?? "";
  return { address: get("Adresse :"), phone: get("Téléphone :"), email: get("E-mail :") };
}

export function SmiePartnerFields({ defaultName = "", defaultContact = "" }: Props) {
  const [name, setName] = useState(defaultName ?? "");
  const initial = parseContact(defaultContact ?? "");
  const [address, setAddress] = useState(initial.address);
  const [phone, setPhone] = useState(initial.phone);
  const [email, setEmail] = useState(initial.email);
  const [selectedId, setSelectedId] = useState("");

  function selectPartner(id: string) {
    setSelectedId(id);
    const partner = smiePartners.find((item) => item.id === id);
    if (!partner) return;
    setName(partner.name);
    setAddress(`Localisation recensée : ${partner.city}, région ${partner.region}. Adresse physique exacte à confirmer auprès de l'organisme.`);
    setPhone("");
    setEmail("");
  }

  const contact = [`Adresse : ${address}`, `Téléphone : ${phone}`, `E-mail : ${email}`].join("\n");

  return <>
    <div className="field">
      <label htmlFor="smie_partner_choice">SMIE partenaire de l'entreprise</label>
      <select id="smie_partner_choice" value={selectedId} onChange={(event) => selectPartner(event.target.value)}>
        <option value="">Sélectionner un SMIE recensé</option>
        {smiePartners.map((partner) => <option key={partner.id} value={partner.id}>{partner.name} - {partner.city}</option>)}
        <option value="__custom">Autre organisme / saisie libre</option>
      </select>
      <label htmlFor="smie_partner_name_manual">Dénomination du partenaire</label>
      <input id="smie_partner_name_manual" value={name} onChange={(event) => { setName(event.target.value); setSelectedId(""); }} maxLength={160} placeholder="Nom officiel du SMIE" />
      <input type="hidden" name="smie_partner_name" value={name} />
      <p className="muted">Référentiel initial de 28 entrées. Les villes sont indicatives ; vérifie l'adresse exacte avant utilisation.</p>
    </div>
    <div className="field">
      <label htmlFor="smie_address">Adresse / localisation de la SMIE</label>
      <textarea id="smie_address" value={address} onChange={(event) => setAddress(event.target.value)} rows={2} maxLength={250} placeholder="Adresse physique de l'organisme" />
    </div>
    <div className="grid2">
      <div className="field"><label htmlFor="smie_phone">Téléphone</label><input id="smie_phone" value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={50} placeholder="Non renseigné si non vérifié" /></div>
      <div className="field"><label htmlFor="smie_email">E-mail</label><input id="smie_email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={100} placeholder="Non renseigné si non vérifié" /></div>
    </div>
    <textarea name="smie_partner_contact" value={contact} readOnly hidden maxLength={500} aria-hidden="true" />
  </>;
}
