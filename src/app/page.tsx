import Link from "next/link";
import {ArrowRight,FileCheck2,LineChart,ShieldCheck,WalletCards} from "lucide-react";
import {BrandMark} from "@/components/brand-mark";
import {LandingMotion} from "@/components/landing-motion";
import "./signature.css";
import "./premium-v2.css";

const pillars=[
  {icon:FileCheck2,title:"Ventes structurées",text:"Prospects, clients, services, devis, commandes, factures et paiements restent liés sans ressaisie inutile."},
  {icon:WalletCards,title:"Trésorerie réelle",text:"Banque, caisse et Mobile Money sont suivis séparément, avec des mouvements issus des opérations réelles."},
  {icon:LineChart,title:"Santé économique",text:"MAGNISA transforme vos données en diagnostics, explications simples, risques et actions prioritaires."}
];
const steps=["Prospect","Client","Devis","Commande","Facture","Paiement","Trésorerie","Analyse"];

export default function Home(){
 return <div className="landing signature premiumV2">
  <LandingMotion/>
  <div className="motionBg" aria-hidden="true">
   <div className="motionHalo motionHaloCyan"/>
   <div className="motionHalo motionHaloViolet"/>
   <div className="motionHalo motionHaloBlue"/>
  </div>
  <header className="signatureHeader">
   <BrandMark/>
   <nav className="signatureNav" aria-label="Navigation principale"><a href="#produit">Produit</a><a href="#fonctionnalites">Fonctionnalités</a><a href="#pilotage">Pilotage</a><a href="#securite">Sécurité</a></nav>
   <div className="signatureHeaderActions"><Link className="signatureBtn signatureBtnOutline" href="/login">Connexion</Link><Link className="signatureBtn signatureBtnPrimary" href="/signup">Commencer <ArrowRight size={15}/></Link></div>
   <details className="signatureMobileNav"><summary aria-label="Afficher la navigation"><span></span><span></span><span></span></summary><nav aria-label="Navigation mobile"><a href="#produit">Produit</a><a href="#fonctionnalites">Fonctionnalités</a><a href="#pilotage">Pilotage</a><a href="#securite">Sécurité</a><Link href="/login">Connexion</Link></nav></details>
  </header>
  <main>
   <section className="signatureHero"><div className="premiumAmbient" aria-hidden="true"/><div className="sonicWave sonicWaveRight" aria-hidden="true"><span/><span/><span/></div><div className="sonicWave sonicWaveLeft" aria-hidden="true"><span/><span/><span/></div>
    <div className="signatureHeroInner">
     <div className="signatureHeroContent">
      <p className="signatureKicker">Pilotage d'entreprise, sans rupture d'information</p>
      <h1>Gérez<br/>mieux.<br/><span>Décidez<br/>mieux.</span></h1>
      <p className="signatureHeroLead">Centralisez votre activité, votre trésorerie, vos ventes et vos décisions financières depuis une seule plateforme.</p>
      <div className="signatureCtas"><Link className="signatureBtn signatureBtnPrimary" href="/signup">Commencer <ArrowRight size={17}/></Link><a className="signatureBtn signatureBtnOutline" href="#produit">Découvrir MAGNISA <span aria-hidden="true">↘</span></a></div>
      <div className="signatureTrust"><ShieldCheck size={17} aria-hidden="true"/><span>Données séparées par organisation, permissions serveur et journal d'audit.</span></div>
     </div>
     <div className="signatureHeroArt">
      <div className="signatureOrbit" aria-hidden="true"></div>
      <div className="signatureVideoFrame"><div className="premiumVideoChrome" aria-hidden="true"><span className="premiumLiveDot"/> EXPÉRIENCE MAGNISA <span>GESTION & PILOTAGE</span></div>
       <video className="signatureHeroVideo" autoPlay loop muted playsInline preload="metadata" aria-label="Présentation de MAGNISA en vidéo"><source src="/VDERA.mp4" type="video/mp4"/></video>
       <div className="signatureFrameFoot" aria-hidden="true"><span>MAGNISA / EXPERIENCE</span><span>MAGNISA</span></div>
      </div>
      <div className="signatureStamp" aria-hidden="true">MAGNISA<small>GÉREZ MIEUX. DÉCIDEZ MIEUX.</small></div>
     </div>
    </div>
    <a className="signatureScroll" href="#produit">EXPLORER L'UNIVERS <span aria-hidden="true">↓</span></a><span className="signatureIndex" aria-hidden="true">01 / 05</span>
   </section>
   <section id="produit" className="signatureSection signatureProduct">
    <div className="signatureReveal motion-reveal">
     <p className="signatureLabel">01 / UNE CHAÎNE MÉTIER COHÉRENTE</p>
     <h2>Une opération saisie une fois. L'information circule partout où elle doit aller.</h2>
     <p className="signatureDescription">MAGNISA relie le commercial, la finance, la comptabilité et l'analyse au lieu de juxtaposer des écrans indépendants.</p>
    </div>
    <div className="signaturePillars">
     {pillars.map(({icon:Icon,title,text},i)=><article className="signaturePillar motion-reveal" key={title}>
      <div className="signaturePillarTop"><span>{String(i+1).padStart(2,"0")} /</span><Icon size={20} strokeWidth={1.6} aria-hidden="true"/></div>
      <h3>{title}</h3><p>{text}</p>
     </article>)}
    </div>
   </section>
   <section id="fonctionnalites" className="signatureWorkflow">
    <div className="signatureWorkflowInner">
     <div className="motion-reveal"><p className="signatureLabel">02 / DE L'OPÉRATION À LA DÉCISION</p><h2>Client → Devis → Commande → Facture → Paiement → Trésorerie → Comptabilité → Analyse</h2><p className="signatureDescription">Chaque étape conserve les relations d'origine, les statuts, les justificatifs et la traçabilité. Les modules peuvent être activés selon les besoins de chaque entreprise.</p></div>
     <div className="signatureSteps">{steps.map((step,i)=><div className="signatureStep motion-reveal" key={step}><span>{String(i+1).padStart(2,"0")}</span><strong>{step}</strong><span className="signatureStepArrow" aria-hidden="true">↗</span></div>)}</div>
    </div>
   </section>
   <section id="pilotage" className="signatureAnalysis">
    <div className="signatureAnalysisInner">
     <div className="motion-reveal"><p className="signatureLabel">03 / MAGNISA ANALYSE</p><h2>Faire parler les chiffres économiquement, puis les expliquer simplement.</h2><p className="signatureDescription">Le moteur d'analyse compare les données réelles, identifie les tensions, explique les causes probables et formule des recommandations mesurables quand les données sont suffisantes.</p></div>
     <div className="signatureAnalysisEntries">
      <div className="signatureAnalysisEntry motion-reveal"><small>Lecture économique</small><p>La rentabilité peut rester positive alors que la liquidité se dégrade si les créances augmentent plus vite que les encaissements.</p></div>
      <div className="signatureAnalysisEntry motion-reveal"><small>En clair</small><p>L'entreprise peut gagner de l'argent sur le papier tout en manquant d'argent disponible.</p></div>
      <div className="signatureAnalysisEntry motion-reveal"><small>Action</small><p>Prioriser le recouvrement des factures échues avant les prochaines sorties critiques.</p></div>
     </div>
    </div>
   </section>
   <section id="securite" className="signatureSecurity">
    <div className="signatureSecurityInner motion-reveal"><ShieldCheck className="signatureSecurityIcon" size={32} strokeWidth={1.5} aria-hidden="true"/><div><h2>Conçu pour devenir un vrai logiciel métier.</h2><p>Architecture multi-entreprise, contrôle d'accès côté serveur, RLS, audit, transactions et base PostgreSQL. Aucun faux indicateur n'est nécessaire pour remplir l'écran.</p></div><Link className="signatureBtn signatureBtnPrimary" href="/signup">Créer mon espace <ArrowRight size={17}/></Link></div>
   </section>
  </main>
  <footer className="signatureFooter"><BrandMark compact/><span>Plateforme SaaS de gestion et de pilotage d'entreprise.</span></footer>
 </div>;
}
