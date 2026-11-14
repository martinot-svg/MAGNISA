import { z } from "zod";
import { ACTIVITY_LABELS, SECTOR_CODES } from "./company-sectors";
import { REGISTRATION_REGIONS } from "@/lib/auth/magnisa-identity";

const short = z.string().trim().max(160);
const optional = z.string().trim().max(300).default("");
const email = z.union([z.literal(""), z.string().trim().email().max(254)]);
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const validDate = (value: string) => {
  const date = new Date(value + "T00:00:00Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0,10) === value;
};
export const COMPANY_LEGAL_FORMS = [
  "EI", "SARL", "SARLU", "SA", "SAU", "SNC", "SCS", "COOPERATIVE", "ASSOCIATION", "AUTRE"
] as const;
export const companyOnboardingSchema = z.object({
  legalName: z.string().trim().min(2).max(160),
  tradeName: optional,
  slogan: optional,
  sectorCode: z.string().refine(value => SECTOR_CODES.includes(value), "Secteur d'activité invalide."),
  primaryActivity: z.string().trim().min(2).max(160),
  secondaryActivities: z.array(short.min(2)).max(100).default([]),
  legalForm: z.enum(COMPANY_LEGAL_FORMS),
  registrationStatus: z.enum(["registered","pending"]),
  nif: optional,
  stat: optional,
  rcs: optional,
  country: z.literal("MG"),
  regionCode: z.string().refine(value => REGISTRATION_REGIONS.some(region => region.code === value), "Région invalide."),
  localityName: z.string().trim().min(2).max(160),
  localityRef: z.string().trim().max(20).default(""),
  address: optional,
  phone: optional,
  email: email,
  currency: z.enum(["MGA","EUR","USD"]),
  taxRegime: z.enum(["IS","IR","A_VERIFIER"]),
  vatStatus: z.enum(["ASSUJETTIE","NON_ASSUJETTIE","A_VERIFIER"]),
  fiscalStart: dateString,
  fiscalEnd: dateString,
  hasExistingAccounts: z.boolean().default(false),
}).superRefine((value, context) => {
  if (!validDate(value.fiscalStart) || !validDate(value.fiscalEnd) || value.fiscalEnd <= value.fiscalStart) {
    context.addIssue({code:"custom",path:["fiscalEnd"],message:"Les dates de l'exercice comptable sont invalides."});
  }
  if (value.secondaryActivities.some(item => item.toLocaleLowerCase("fr") === value.primaryActivity.toLocaleLowerCase("fr"))) {
    context.addIssue({code:"custom",path:["secondaryActivities"],message:"L'activité principale ne doit pas figurer parmi les activités secondaires."});
  }
  if (new Set(value.secondaryActivities.map(x => x.toLowerCase())).size !== value.secondaryActivities.length) {
    context.addIssue({code:"custom",path:["secondaryActivities"],message:"Une activité secondaire est indiquée plusieurs fois."});
  }
  // A principal activity may be entered freely when the suggested catalogue has no match.
  const sectorOptions = ACTIVITY_LABELS.filter(x => x.sector === value.sectorCode);
  if (!sectorOptions.length) {
    context.addIssue({code:"custom",path:["sectorCode"],message:"Secteur indisponible."});
  }
});
export type CompanyOnboardingInput = z.input<typeof companyOnboardingSchema>;
export type CompanyOnboarding = z.output<typeof companyOnboardingSchema>;
