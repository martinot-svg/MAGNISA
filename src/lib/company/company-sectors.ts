/** Initial user-friendly activity catalogue.
 * Broad sections follow NOMAC 2012 (INSTAT). These detailed examples are UI
 * search labels, not certified NOMAC category codes; the 1903-code catalogue
 * needs separate verified ingestion. */
export type ActivityGroup = { label: string; activities: readonly string[] };
export type ActivitySector = { code: string; label: string; groups: readonly ActivityGroup[] };
export const COMPANY_SECTORS: readonly ActivitySector[] = [
  {
    "code": "A",
    "label": "Agriculture, élevage, sylviculture, pêche et aquaculture",
    "groups": [
      {
        "label": "Cultures",
        "activities": [
          "Riziculture",
          "Cultures maraîchères",
          "Culture du manioc",
          "Culture du maïs",
          "Culture de la vanille",
          "Culture du girofle",
          "Culture du café",
          "Cultures fruitières",
          "Culture du coton"
        ]
      },
      {
        "label": "Élevage",
        "activities": [
          "Élevage bovin",
          "Élevage de volailles",
          "Élevage porcin",
          "Élevage caprin",
          "Apiculture",
          "Production laitière"
        ]
      },
      {
        "label": "Pêche et forêts",
        "activities": [
          "Pêche artisanale",
          "Pêche maritime",
          "Aquaculture",
          "Pisciculture",
          "Sylviculture",
          "Exploitation forestière"
        ]
      }
    ]
  },
  {
    "code": "B",
    "label": "Industries extractives",
    "groups": [
      {
        "label": "Extraction",
        "activities": [
          "Extraction de pierres",
          "Extraction de sable",
          "Extraction de minerais",
          "Exploitation de carrières",
          "Extraction de sel"
        ]
      }
    ]
  },
  {
    "code": "C",
    "label": "Industries manufacturières",
    "groups": [
      {
        "label": "Agroalimentaire",
        "activities": [
          "Transformation du riz",
          "Boulangerie et pâtisserie",
          "Transformation du lait",
          "Transformation de fruits",
          "Fabrication de boissons",
          "Conserverie de poissons"
        ]
      },
      {
        "label": "Textile et artisanat",
        "activities": [
          "Confection de vêtements",
          "Filature et tissage",
          "Fabrication de chaussures",
          "Travail du cuir",
          "Bijouterie artisanale"
        ]
      },
      {
        "label": "Production industrielle",
        "activities": [
          "Menuiserie et fabrication de meubles",
          "Imprimerie",
          "Fabrication de matériaux de construction",
          "Fabrication de produits métalliques",
          "Production de savons",
          "Fabrication d'emballages"
        ]
      }
    ]
  },
  {
    "code": "D",
    "label": "Électricité, gaz, vapeur et climatisation",
    "groups": [
      {
        "label": "Énergie",
        "activities": [
          "Production d'électricité",
          "Distribution d'électricité",
          "Énergie solaire",
          "Production de gaz",
          "Fourniture de climatisation"
        ]
      }
    ]
  },
  {
    "code": "E",
    "label": "Eau, assainissement et gestion des déchets",
    "groups": [
      {
        "label": "Environnement",
        "activities": [
          "Distribution d'eau",
          "Collecte des déchets",
          "Recyclage",
          "Assainissement",
          "Traitement des eaux usées",
          "Dépollution"
        ]
      }
    ]
  },
  {
    "code": "F",
    "label": "Construction et BTP",
    "groups": [
      {
        "label": "Bâtiment",
        "activities": [
          "Construction de maisons",
          "Construction d'immeubles",
          "Maçonnerie",
          "Charpenterie et couverture",
          "Peinture",
          "Plomberie",
          "Électricité du bâtiment",
          "Carrelage"
        ]
      },
      {
        "label": "Travaux publics",
        "activities": [
          "Construction de routes",
          "Terrassement",
          "Construction de ponts",
          "Génie civil",
          "Forage",
          "Installation de réseaux"
        ]
      }
    ]
  },
  {
    "code": "G",
    "label": "Commerce et réparation de véhicules",
    "groups": [
      {
        "label": "Commerce de détail",
        "activities": [
          "Épicerie",
          "Alimentation générale",
          "Boutique de vêtements",
          "Quincaillerie",
          "Vente de matériaux de construction",
          "Vente de téléphones",
          "Vente de matériel informatique",
          "Vente de meubles",
          "Commerce de cosmétiques",
          "Commerce de pièces automobiles",
          "Pharmacie et produits pharmaceutiques",
          "Commerce en ligne"
        ]
      },
      {
        "label": "Commerce de gros",
        "activities": [
          "Grossiste alimentaire",
          "Grossiste textile",
          "Distribution de boissons",
          "Commerce de produits agricoles",
          "Import-export",
          "Grossiste en matériaux",
          "Distribution de pièces détachées"
        ]
      },
      {
        "label": "Automobile et motos",
        "activities": [
          "Vente de véhicules",
          "Vente de motos",
          "Garage automobile",
          "Réparation de motos",
          "Vente de pneus",
          "Entretien automobile"
        ]
      }
    ]
  },
  {
    "code": "H",
    "label": "Transport et entreposage",
    "groups": [
      {
        "label": "Transport",
        "activities": [
          "Taxi et VTC",
          "Transport interurbain",
          "Transport routier de marchandises",
          "Transport maritime",
          "Transport fluvial",
          "Transport aérien",
          "Transport scolaire",
          "Livraison et coursier"
        ]
      },
      {
        "label": "Logistique",
        "activities": [
          "Entreposage",
          "Transit douanier",
          "Déménagement",
          "Gestion de flotte",
          "Location de véhicules avec chauffeur"
        ]
      }
    ]
  },
  {
    "code": "I",
    "label": "Hébergement et restauration",
    "groups": [
      {
        "label": "Hébergement",
        "activities": [
          "Hôtel",
          "Maison d'hôtes",
          "Auberge",
          "Location touristique",
          "Camping"
        ]
      },
      {
        "label": "Restauration",
        "activities": [
          "Restaurant",
          "Restauration rapide",
          "Traiteur",
          "Cantine",
          "Café",
          "Salon de thé",
          "Pâtisserie"
        ]
      }
    ]
  },
  {
    "code": "J",
    "label": "Information et communication",
    "groups": [
      {
        "label": "Numérique",
        "activities": [
          "Développement de logiciels",
          "Création de sites web",
          "Services informatiques",
          "Hébergement informatique",
          "Télécommunications",
          "Cybersécurité",
          "Conseil informatique"
        ]
      },
      {
        "label": "Médias",
        "activities": [
          "Production audiovisuelle",
          "Photographie",
          "Édition de journaux",
          "Radio",
          "Production de vidéos",
          "Création de contenus numériques"
        ]
      }
    ]
  },
  {
    "code": "K",
    "label": "Activités financières et assurances",
    "groups": [
      {
        "label": "Services financiers",
        "activities": [
          "Microfinance",
          "Intermédiation financière",
          "Assurance",
          "Courtage en assurance",
          "Services de paiement",
          "Conseil en investissement"
        ]
      }
    ]
  },
  {
    "code": "L",
    "label": "Activités immobilières",
    "groups": [
      {
        "label": "Immobilier",
        "activities": [
          "Agence immobilière",
          "Gestion locative",
          "Promotion immobilière",
          "Location de bureaux",
          "Location de logements",
          "Expertise immobilière"
        ]
      }
    ]
  },
  {
    "code": "M",
    "label": "Services professionnels, scientifiques et techniques",
    "groups": [
      {
        "label": "Conseil et expertise",
        "activities": [
          "Conseil en gestion",
          "Cabinet comptable",
          "Expertise juridique",
          "Audit",
          "Ingénierie",
          "Architecture",
          "Géomètre",
          "Études de marché",
          "Recherche et développement"
        ]
      },
      {
        "label": "Communication",
        "activities": [
          "Agence de publicité",
          "Design graphique",
          "Relations publiques",
          "Traduction et interprétation"
        ]
      }
    ]
  },
  {
    "code": "N",
    "label": "Services administratifs et de soutien",
    "groups": [
      {
        "label": "Soutien aux entreprises",
        "activities": [
          "Nettoyage professionnel",
          "Sécurité privée",
          "Recrutement",
          "Intérim",
          "Secrétariat externalisé",
          "Centre d'appels",
          "Organisation d'événements",
          "Location de matériel",
          "Entretien d'espaces verts"
        ]
      }
    ]
  },
  {
    "code": "O",
    "label": "Administration publique et défense",
    "groups": [
      {
        "label": "Administration",
        "activities": [
          "Administration générale",
          "Services publics",
          "Défense",
          "Sécurité sociale obligatoire"
        ]
      }
    ]
  },
  {
    "code": "P",
    "label": "Éducation",
    "groups": [
      {
        "label": "Formation",
        "activities": [
          "Enseignement préscolaire",
          "École primaire",
          "Enseignement secondaire",
          "Enseignement supérieur",
          "Formation professionnelle",
          "Cours de langues",
          "Soutien scolaire",
          "Formation numérique"
        ]
      }
    ]
  },
  {
    "code": "Q",
    "label": "Santé et action sociale",
    "groups": [
      {
        "label": "Santé",
        "activities": [
          "Cabinet médical",
          "Clinique",
          "Laboratoire médical",
          "Cabinet dentaire",
          "Soins infirmiers",
          "Kinésithérapie",
          "Activités hospitalières"
        ]
      },
      {
        "label": "Action sociale",
        "activities": [
          "Aide à domicile",
          "Services sociaux",
          "Accueil de personnes âgées",
          "Assistance aux personnes vulnérables"
        ]
      }
    ]
  },
  {
    "code": "R",
    "label": "Arts, spectacles et loisirs",
    "groups": [
      {
        "label": "Loisirs",
        "activities": [
          "Production musicale",
          "Organisation de spectacles",
          "Cinéma",
          "Sports et remise en forme",
          "Salle de sport",
          "Animation touristique",
          "Parcs de loisirs",
          "Artisanat artistique"
        ]
      }
    ]
  },
  {
    "code": "S",
    "label": "Autres services",
    "groups": [
      {
        "label": "Services personnels",
        "activities": [
          "Coiffure",
          "Barbier",
          "Esthétique",
          "Blanchisserie",
          "Couture et retouches",
          "Réparation de téléphones",
          "Réparation d'appareils ménagers",
          "Réparation d'ordinateurs",
          "Services funéraires"
        ]
      }
    ]
  },
  {
    "code": "T",
    "label": "Activités des ménages employeurs",
    "groups": [
      {
        "label": "Ménages",
        "activities": [
          "Personnel domestique",
          "Production des ménages pour usage propre"
        ]
      }
    ]
  },
  {
    "code": "U",
    "label": "Organisations extraterritoriales",
    "groups": [
      {
        "label": "Organisations",
        "activities": [
          "Organisations internationales",
          "Organismes extraterritoriaux"
        ]
      }
    ]
  }
] as const;
export const SECTOR_CODES = COMPANY_SECTORS.map(sector => sector.code);
export const ACTIVITY_LABELS = COMPANY_SECTORS.flatMap(sector =>
  sector.groups.flatMap(group => group.activities.map(activity => ({ sector: sector.code, group: group.label, activity }))));
export function activitiesForSector(sectorCode: string) {
  return COMPANY_SECTORS.find(sector => sector.code === sectorCode)?.groups ?? [];
}
