/** Calculation for employee medical-service contributions. Rates are fractions (0.01 = 1%). */
export function computeHealthContribution(grossSubjectToContribution:number,ceiling:number,employeeRate:number,employerRate:number){
  if (![grossSubjectToContribution,ceiling,employeeRate,employerRate].every(Number.isFinite) ||
      grossSubjectToContribution<0 || ceiling<=0 || employeeRate<0 || employeeRate>1 || employerRate<0 || employerRate>1)
    throw new Error("Paramètres de cotisation sanitaire invalides.");
  const base=Math.min(grossSubjectToContribution,ceiling);
  const round=(n:number)=>Math.round(n*100)/100;
  return {base,employee:round(base*employeeRate),employer:round(base*employerRate)};
}
