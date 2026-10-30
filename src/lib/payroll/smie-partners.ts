export type SmiePartner = {
  id: string;
  name: string;
  city: string;
  region: string;
  address: string;
  phone: string;
  email: string;
  verification: "official" | "institutional" | "directory" | "historical" | "location-only";
  sourceNote: string;
};

/**
 * Référentiel initial de 28 organismes cités dans le tableau 10 du Profil national SST
 * de Madagascar (OIT / DSST). Les coordonnées ne sont préremplies que lorsqu'une
 * source publique identifiable les étaye. Les contacts anciens ou d'annuaire sont
 * signalés dans verification/sourceNote et doivent être confirmés par l'entreprise.
 */
export const smiePartners: SmiePartner[] = [
  { id: "OSTIE-antananarivo", name: "OSTIE", city: "Antananarivo", region: "Analamanga", address: "Rue Dr Zamenhof, Behoririka, Antananarivo 101, Madagascar - BP 165", phone: "+261 20 22 265 78", email: "", verification: "official", sourceNote: "Site officiel OSTIE et CLEISS 2026" },
  { id: "AMIT-antananarivo", name: "AMIT", city: "Antananarivo", region: "Analamanga", address: "Lot IVE 21, Behoririka, Antananarivo 101, Madagascar", phone: "+261 33 51 303 08", email: "amitbeho@amit.mg", verification: "institutional", sourceNote: "GEFP et CLEISS 2026" },
  { id: "ESIA-antananarivo", name: "ESIA", city: "Antananarivo", region: "Analamanga", address: "102 Pont Bailey, Antananarivo, Madagascar", phone: "+261 34 02 088 02", email: "", verification: "institutional", sourceNote: "CLEISS 2026" },
  { id: "FUNHECE-antananarivo", name: "FUNHECE", city: "Antananarivo", region: "Analamanga", address: "Enceinte Prisme Ouest, Ambohijanahary, Antananarivo, Madagascar", phone: "+261 32 02 028 64", email: "", verification: "directory", sourceNote: "Annuaire commercial consulté en 2026 ; numéro à confirmer directement" },
  { id: "SMIA-antsirabe", name: "SMIA", city: "Antsirabe", region: "Vakinankaratra", address: "Rue Voltaire, route d'Ambositra, BP 85, Antsirabe 110, Madagascar", phone: "+261 20 44 486 02 / +261 20 44 480 02 / +261 34 34 486 35", email: "dir.etab@smia.mg", verification: "institutional", sourceNote: "Avis de marché du SMIA publié en 2023 et site officiel SMIA" },
  { id: "FUNABE-antsirabe", name: "FUNABE", city: "Antsirabe", region: "Vakinankaratra", address: "Antsirabe, Vakinankaratra, Madagascar - adresse précise à confirmer", phone: "", email: "", verification: "location-only", sourceNote: "Recensement OIT / DSST ; coordonnées non recoupées" },
  { id: "OSIEF-fianarantsoa", name: "OSIEF", city: "Fianarantsoa", region: "Haute Matsiatra", address: "Antarandolo, Fianarantsoa 301, Madagascar", phone: "+261 34 02 815 62", email: "", verification: "directory", sourceNote: "Annuaire professionnel consulté ; adresse de secteur, téléphone à confirmer" },
  { id: "FUNFIA-fianarantsoa", name: "FUNFIA", city: "Fianarantsoa", region: "Haute Matsiatra", address: "Fianarantsoa 301, Madagascar - adresse précise à confirmer", phone: "", email: "", verification: "location-only", sourceNote: "Recensement OIT / DSST ; coordonnées non recoupées" },
  { id: "ORSANAM-ambositra", name: "ORSANAM", city: "Ambositra", region: "Amoron'i Mania", address: "Lot II E8, Manolotrony, Ambositra 306, Madagascar", phone: "+261 20 75 710 48", email: "", verification: "historical", sourceNote: "Ancien annuaire professionnel et cartographie ; coordonnées à confirmer" },
  { id: "OSIER-ranofamana", name: "OSIER", city: "Ranomafana", region: "Haute Matsiatra", address: "Ranomafana, Haute Matsiatra, Madagascar - adresse précise à confirmer", phone: "", email: "", verification: "location-only", sourceNote: "Recensement OIT / DSST ; coordonnées non recoupées" },
  { id: "OSIEMI-mananjary", name: "OSIEMI", city: "Mananjary", region: "Vatovavy", address: "BP 38, Villa Agnès, Tanambazaha, Mananjary 317, Madagascar", phone: "+261 20 73 942 92", email: "", verification: "historical", sourceNote: "Ancien annuaire professionnel ; coordonnées à confirmer" },
  { id: "OSIEM-manakara", name: "OSIEM", city: "Manakara", region: "Fitovinany", address: "BP 108, Ankofafa, Manakara 316, Madagascar", phone: "+261 20 72 213 91", email: "osiemanakara@gmail.com", verification: "directory", sourceNote: "Annuaires professionnels 2019 et 2021-2022" },
  { id: "OSIEFA-farafangana", name: "OSIEFA", city: "Farafangana", region: "Atsimo-Atsinanana", address: "BP 229, Farafangana 309, Madagascar", phone: "+261 20 73 910 10", email: "", verification: "historical", sourceNote: "Ancien annuaire professionnel ; coordonnées à confirmer" },
  { id: "OSIEM-mahajanga", name: "OSIEM", city: "Mahajanga", region: "Boeny", address: "Mahajanga 401, Madagascar - adresse précise à confirmer", phone: "", email: "", verification: "location-only", sourceNote: "Recensement OIT / DSST ; attention, ne pas confondre avec OSIEM de Manakara ou Morondava" },
  { id: "SMIM-mahajanga", name: "SMIM", city: "Mahajanga", region: "Boeny", address: "Lot 0101 AG 0020, avenue de la Libération, Mangarivotra, Mahajanga 401, Madagascar", phone: "+261 20 62 247 19 / +261 20 62 247 00", email: "smim.ng@moov.mg", verification: "directory", sourceNote: "Annuaires professionnels 2019 et 2021-2022" },
  { id: "OMSI-toamasina", name: "OMSI", city: "Toamasina", region: "Atsinanana", address: "Boulevard de la Fidélité, près de la Gare Manguier, BP 424, Toamasina 501, Madagascar", phone: "+261 20 53 323 37", email: "omsitmm@moov.mg", verification: "directory", sourceNote: "Étude universitaire malgache et annuaires professionnels ; téléphone recoupé" },
  { id: "FUNTOA-toamasina", name: "FUNTOA", city: "Toamasina", region: "Atsinanana", address: "Lot 1599 Carreau II, Parcelle 11/14, Mangarivotra Nord, Toamasina 501, Madagascar", phone: "", email: "", verification: "directory", sourceNote: "Fiche professionnelle récente ; téléphone et e-mail non publiés" },
  { id: "SMIA-ambatondrazaka", name: "SMIA", city: "Ambatondrazaka", region: "Alaotra-Mangoro", address: "Ambatondrazaka, Alaotra-Mangoro, Madagascar - adresse précise à confirmer", phone: "", email: "", verification: "location-only", sourceNote: "Recensement OIT / DSST ; dénomination à confirmer localement" },
  { id: "SMIMO-moramanga", name: "SMIMO", city: "Moramanga", region: "Alaotra-Mangoro", address: "BP 23, Moramanga 514, Madagascar", phone: "", email: "smimomga@gmail.com", verification: "directory", sourceNote: "Avis de recrutement du SMIMO publié en décembre 2023" },
  { id: "SMIDS-antsiranana", name: "SMIDS", city: "Antsiranana", region: "Diana", address: "Boulevard Étienne, 4 Étages, enceinte Compagnie Salinière, Antsiranana 201, Madagascar", phone: "+261 20 82 225 96", email: "", verification: "directory", sourceNote: "Répertoire médical du gouvernement britannique ; adresse du cabinet SMIDS" },
  { id: "OMINO-nosy-be", name: "OMINO", city: "Nosy Be", region: "Diana", address: "Camp Vert, Hell-Ville, Nosy Be 207, Madagascar", phone: "+261 20 86 611 77", email: "", verification: "directory", sourceNote: "Fiche professionnelle récente et répertoire médical Medpages" },
  { id: "SMIEN-nosy-be", name: "SMIEN", city: "Nosy Be", region: "Diana", address: "Nosy Be 207, Madagascar - adresse précise à confirmer", phone: "", email: "", verification: "location-only", sourceNote: "Recensement OIT / DSST ; coordonnées non recoupées" },
  { id: "SMIA-ambanja", name: "SMIA", city: "Ambanja", region: "Diana", address: "BP 65, Ambanja 203, Madagascar", phone: "", email: "", verification: "historical", sourceNote: "Ancien répertoire des SMIE ; dénomination historique également relevée comme OSMIA" },
  { id: "SMISA-sambava", name: "SMISA", city: "Sambava", region: "Sava", address: "BP 54, Sambava 208, Madagascar", phone: "", email: "", verification: "historical", sourceNote: "Ancien répertoire des SMIE ; coordonnées à confirmer" },
  { id: "SMIA-antalaha", name: "SMIA", city: "Antalaha", region: "Sava", address: "Rue des Bordeaux, Antalaha 206, Madagascar", phone: "+261 20 88 812 86", email: "", verification: "historical", sourceNote: "Ancien répertoire des SMIE ; coordonnées à confirmer" },
  { id: "OMIT-toliara", name: "OMIT", city: "Toliara", region: "Atsimo-Andrefana", address: "Betania Ouest, Toliara I, Madagascar", phone: "+261 20 94 920 30", email: "omit@moov.mg", verification: "directory", sourceNote: "OpenStreetMap et annuaires cartographiques ; numéro local publié sans indicatif dans certaines sources" },
  { id: "OSIEM-morondava", name: "OSIEM", city: "Morondava", region: "Menabe", address: "BP 189, Morondava 619, Madagascar", phone: "+261 20 95 523 87", email: "", verification: "historical", sourceNote: "Ancien répertoire des SMIE ; coordonnées à confirmer" },
  { id: "OSIET-tolagnaro", name: "OSIET", city: "Tolagnaro", region: "Anosy", address: "Bazary Be, Tolagnaro 614, Madagascar", phone: "+261 20 92 904 57", email: "", verification: "historical", sourceNote: "Ancien répertoire des SMIE ; coordonnées à confirmer" },
];
