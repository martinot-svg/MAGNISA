export type SmiePartner = { id: string; name: string; city: string; region: string };

/**
 * Référentiel initial issu du profil national SST/OIT cité dans la documentation MAGNISA.
 * Les villes sont des localisations de recensement, pas des adresses postales vérifiées.
 * Téléphones et e-mails restent vides tant qu'une source officielle actuelle ne les confirme.
 */
export const smiePartners: SmiePartner[] = [
  { id: "OSTIE-antananarivo", name: "OSTIE", city: "Antananarivo", region: "Analamanga" },
  { id: "AMIT-antananarivo", name: "AMIT", city: "Antananarivo", region: "Analamanga" },
  { id: "ESIA-antananarivo", name: "ESIA", city: "Antananarivo", region: "Analamanga" },
  { id: "FUNHECE-antananarivo", name: "FUNHECE", city: "Antananarivo", region: "Analamanga" },
  { id: "SMIA-antsirabe", name: "SMIA", city: "Antsirabe", region: "Vakinankaratra" },
  { id: "FUNABE-antsirabe", name: "FUNABE", city: "Antsirabe", region: "Vakinankaratra" },
  { id: "OSIEF-fianarantsoa", name: "OSIEF", city: "Fianarantsoa", region: "Haute Matsiatra" },
  { id: "FUNFIA-fianarantsoa", name: "FUNFIA", city: "Fianarantsoa", region: "Haute Matsiatra" },
  { id: "ORSANAM-ambositra", name: "ORSANAM", city: "Ambositra", region: "Amoron'i Mania" },
  { id: "OSIER-ranofamana", name: "OSIER", city: "Ranomafana", region: "Haute Matsiatra" },
  { id: "OSIEMI-mananjary", name: "OSIEMI", city: "Mananjary", region: "Vatovavy" },
  { id: "OSIEM-manakara", name: "OSIEM", city: "Manakara", region: "Fitovinany" },
  { id: "OSIEFA-farafangana", name: "OSIEFA", city: "Farafangana", region: "Atsimo-Atsinanana" },
  { id: "OSIEM-mahajanga", name: "OSIEM", city: "Mahajanga", region: "Boeny" },
  { id: "SMIM-mahajanga", name: "SMIM", city: "Mahajanga", region: "Boeny" },
  { id: "OMSI-toamasina", name: "OMSI", city: "Toamasina", region: "Atsinanana" },
  { id: "FUNTOA-toamasina", name: "FUNTOA", city: "Toamasina", region: "Atsinanana" },
  { id: "SMIA-ambatondrazaka", name: "SMIA", city: "Ambatondrazaka", region: "Alaotra-Mangoro" },
  { id: "SMIMO-moramanga", name: "SMIMO", city: "Moramanga", region: "Alaotra-Mangoro" },
  { id: "SMIDS-antsiranana", name: "SMIDS", city: "Antsiranana", region: "Diana" },
  { id: "OMINO-nosy-be", name: "OMINO", city: "Nosy Be", region: "Diana" },
  { id: "SMIEN-nosy-be", name: "SMIEN", city: "Nosy Be", region: "Diana" },
  { id: "SMIA-ambanja", name: "SMIA", city: "Ambanja", region: "Diana" },
  { id: "SMISA-sambava", name: "SMISA", city: "Sambava", region: "Sava" },
  { id: "SMIA-antalaha", name: "SMIA", city: "Antalaha", region: "Sava" },
  { id: "OMIT-toliara", name: "OMIT", city: "Toliara", region: "Atsimo-Andrefana" },
  { id: "OSIEM-morondava", name: "OSIEM", city: "Morondava", region: "Menabe" },
  { id: "OSIET-tolagnaro", name: "OSIET", city: "Tolagnaro", region: "Anosy" },
];
