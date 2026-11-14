import { describe,it,expect } from "vitest";
import { companyOnboardingSchema } from "./onboarding-schema";
import { COMPANY_SECTORS,ACTIVITY_LABELS } from "./company-sectors";
const valid = {
  legalName:"Entreprise Ambahikily",tradeName:"",slogan:"",
  sectorCode:"G", primaryActivity:"Épicerie",secondaryActivities:["Livraison et coursier"],
  legalForm:"EI",registrationStatus:"pending",nif:"",stat:"",rcs:"",
  country:"MG",regionCode:"908",localityName:"Ambahikily",localityRef:"",
  address:"Morombe",phone:"",email:"",currency:"MGA",
  taxRegime:"A_VERIFIER",vatStatus:"A_VERIFIER",
  fiscalStart:"2026-02-01",fiscalEnd:"2027-01-31",hasExistingAccounts:false,
};
describe("Création d'entreprise MAGNISA",()=>{
  it("présente 21 secteurs et plus de 200 activités illustratives",()=>{
    expect(COMPANY_SECTORS).toHaveLength(21);
    expect(ACTIVITY_LABELS.length).toBeGreaterThan(200);
    expect(ACTIVITY_LABELS.some(a=>a.activity==="Épicerie"&&a.sector==="G")).toBe(true);
    expect(ACTIVITY_LABELS.some(a=>a.activity==="Coiffure"&&a.sector==="S")).toBe(true);
  });
  it("accepte une entreprise en formalisation et un exercice décalé",()=>{
    expect(companyOnboardingSchema.safeParse(valid).success).toBe(true);
  });
  it("refuse les dates impossibles, inversées ou identiques",()=>{
    expect(companyOnboardingSchema.safeParse({...valid,fiscalStart:"2026-02-31"}).success).toBe(false);
    expect(companyOnboardingSchema.safeParse({...valid,fiscalEnd:"2026-01-31"}).success).toBe(false);
    expect(companyOnboardingSchema.safeParse({...valid,fiscalEnd:"2026-02-01"}).success).toBe(false);
  });
  it("refuse un secteur non validé, une mauvaise région ou un pays inventé",()=>{
    expect(companyOnboardingSchema.safeParse({...valid,sectorCode:"XX"}).success).toBe(false);
    expect(companyOnboardingSchema.safeParse({...valid,regionCode:"999"}).success).toBe(false);
    expect(companyOnboardingSchema.safeParse({...valid,country:"FR"}).success).toBe(false);
  });
  it("accepte une activité libre et refuse les secondaires en double",()=>{
    expect(companyOnboardingSchema.safeParse({...valid,primaryActivity:"Réparation de machines agricoles"}).success).toBe(true);
    expect(companyOnboardingSchema.safeParse({...valid,secondaryActivities:["Épicerie"]}).success).toBe(false);
    expect(companyOnboardingSchema.safeParse({...valid,secondaryActivities:["Transport","transport"]}).success).toBe(false);
  });
  it("garde IS et IR distincts de la TVA et ne certifie pas le régime",()=>{
    expect(companyOnboardingSchema.safeParse({...valid,taxRegime:"IS",vatStatus:"A_VERIFIER"}).success).toBe(true);
    expect(companyOnboardingSchema.safeParse({...valid,taxRegime:"IR",vatStatus:"NON_ASSUJETTIE"}).success).toBe(true);
    expect(companyOnboardingSchema.safeParse({...valid,taxRegime:"IRSA"}).success).toBe(false);
  });
});
