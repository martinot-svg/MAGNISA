import Link from "next/link";
import {notFound} from "next/navigation";
import {loadPayslip} from "@/lib/payroll/payslip-document";
import {PayslipMail} from "@/components/payslip-mail";
export default async function PayslipDetail({params}:{params:Promise<{id:string}>}){
 const {id}=await params;const result=await loadPayslip(id);if(!result)notFound();const {slip:s,data,email}=result;
 const fmt=(x:number)=>new Intl.NumberFormat("fr-FR",{style:"currency",currency:data.currency}).format(Number(x)||0);
 const rows:[string,string][]=[["base_salary","Salaire de base"],["bonuses","Primes"],["overtime","Heures supplémentaires"],["other_earnings","Autres gains"],["gross_pay","Salaire brut"],["employee_social","CNaPS et autres cotisations salariales"],["employee_health","Cotisations santé salariales"],["income_tax","IRSA"],["advances_recovered","Avances récupérées"],["other_deductions","Autres retenues"],["employer_social","Charges sociales patronales"],["employer_health","Charges santé patronales"],["net_pay","Net à payer"],["paid_amount","Déjà payé"]];
 const url="/api/payroll/payslips/"+encodeURIComponent(id)+"/pdf";const final=["validated","partially_paid","paid"].includes(s.status);
 return <><div className="pageHead"><div><p className="eyebrow">Personnel & Paie</p><h1>{data.number}</h1><p>{data.employee} - {data.period} - {final?"Bulletin validé":"BULLETIN PROVISOIRE"}</p></div><Link className="button" href="/paie">Retour aux bulletins</Link></div>
 <div className="card"><h2>Aperçu du bulletin</h2><p>{data.company}{data.address?" - "+data.address:""}</p><div className="tableWrap"><table><thead><tr><th>Rubrique</th><th className="right">Montant</th></tr></thead><tbody>{rows.map(([key,label])=><tr key={key}><td>{label}</td><td className="right">{fmt(s[key])}</td></tr>)}</tbody></table></div><div className="actions" style={{marginTop:18}}><a className="button primary" href={url} target="_blank" rel="noreferrer">Aperçu PDF / Imprimer</a><a className="button" href={url} download={data.number+".pdf"}>Télécharger PDF</a></div>{final?<PayslipMail id={id} email={email} number={data.number}/>:<p className="muted">L'envoi par e-mail sera disponible après validation comptable du bulletin.</p>}</div></>;
}
