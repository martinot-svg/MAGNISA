import Link from "next/link";
import {ArrowRight,ShieldCheck} from "lucide-react";
import {BrandMark} from "@/components/brand-mark";
import {LandingMotion} from "@/components/landing-motion";
import "./signature.css";
import "./premium-v2.css";

const pillars=[
 {kind:"commercial",label:"GESTION COMMERCIALE",title:"De vos premiers échanges à la facturation",text:"Retrouvez vos clients, prestations, devis, commandes et factures dans un parcours commercial structuré, avec un suivi clair de chaque opération."},
 {kind:"financial",label:"GESTION FINANCIÈRE",title:"Une trésorerie suivie à la source",text:"Suivez vos encaissements, décaissements et soldes par compte bancaire, caisse ou Mobile Money, pour distinguer les flux financiers et connaître les disponibilités de votre entreprise."},
 {kind:"analysis",label:"ANALYSE ET PILOTAGE",title:"Des chiffres qui révèlent l'essentiel",text:"Accédez à des indicateurs pour suivre vos performances, repérer les créances, surveiller les engagements et identifier les points qui méritent votre attention."}
] as const;

/* Lightweight SVG illustrations: animated with CSS, no external image assets. */
function PillarIllustration({kind}:{kind:"commercial"|"financial"|"analysis"}){
 if(kind==="commercial") return <div className="magPillarArt magPillarPhoto"><img src="/gestion-commerciale.svg" alt="Présentation d'une analyse commerciale entre professionnels, avec un tableau de bord financier sur ordinateur" loading="lazy" decoding="async"/></div>;
 const label=kind==="financial"?"Flux entre les comptes financiers":"Indicateurs et analyse de performance";
 return <div className={`magPillarArt magPillarArt--${kind}`} role="img" aria-label={label}>
  <svg viewBox="0 0 300 154" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
   <defs>
    <linearGradient id={`artGradient-${kind}`} x1="30" y1="10" x2="267" y2="143" gradientUnits="userSpaceOnUse"><stop stopColor="#17D7F7"/><stop offset=".48" stopColor="#2863FF"/><stop offset=".78" stopColor="#8248F6"/><stop offset="1" stopColor="#D83DEA"/></linearGradient>
    <linearGradient id={`artSurface-${kind}`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#FFFFFF"/><stop offset="1" stopColor="#E8F0FF"/></linearGradient>
   </defs>
   <ellipse cx="150" cy="83" rx="129" ry="62" stroke={`url(#artGradient-${kind})`} strokeWidth="1" strokeDasharray="5 8" opacity=".28" className="magOrbit"/>
   {kind==="financial"?<>
    <rect x="91" y="21" width="118" height="83" rx="17" fill={`url(#artSurface-${kind})`} stroke="#B8CDFF" strokeWidth="1.5" className="magArtFloat"/>
    <path d="M120 48L150 31L180 48V53H120V48Z" fill="#D0E8FF" stroke="#2863FF" strokeWidth="2"/><path d="M126 58V80M150 58V80M174 58V80" stroke="#557CFC" strokeWidth="5" strokeLinecap="round"/><path d="M119 86H181" stroke="#2863FF" strokeWidth="4" strokeLinecap="round"/>
    <path d="M135 107C103 127 70 122 61 113M165 107C197 127 230 122 239 113" stroke={`url(#artGradient-${kind})`} strokeWidth="3" strokeLinecap="round" strokeDasharray="5 6" className="magFlow"/>
    <rect x="18" y="97" width="80" height="42" rx="12" fill="#E8F9FF" stroke="#26C6F4" strokeWidth="1.5"/><rect x="32" y="109" width="45" height="6" rx="3" fill="#25BDFC"/><rect x="32" y="122" width="29" height="5" rx="2.5" fill="#80D9F6"/>
    <rect x="202" y="97" width="80" height="42" rx="12" fill="#F5EAFE" stroke="#B88DFE" strokeWidth="1.5"/><rect x="216" y="109" width="45" height="6" rx="3" fill="#9652F6"/><rect x="216" y="122" width="29" height="5" rx="2.5" fill="#D38AF5"/>
    <circle cx="150" cy="110" r="8" fill="#FFFFFF" stroke="#4468FA" strokeWidth="3" className="magArtPulse"/>
   </>:<>
    <rect x="39" y="22" width="222" height="113" rx="17" fill={`url(#artSurface-${kind})`} stroke="#BDC8FA" strokeWidth="1.5" className="magArtFloat"/>
    <path d="M63 107H239M63 107V46" stroke="#B8C7ED" strokeWidth="2"/>
    <rect x="81" y="84" width="17" height="23" rx="4" fill="#9DDAFF"/><rect x="114" y="71" width="17" height="36" rx="4" fill="#6E9CFF"/><rect x="147" y="56" width="17" height="51" rx="4" fill="#7659FB"/><rect x="180" y="38" width="17" height="69" rx="4" fill="#BC65EF"/>
    <path d="M76 83L122 61L154 70L208 35" stroke={`url(#artGradient-${kind})`} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" className="magFlow"/>
    <circle cx="208" cy="35" r="8" fill="#FFFFFF" stroke="#D83DEA" strokeWidth="4" className="magArtPulse"/>
    <rect x="215" y="74" width="32" height="20" rx="8" fill="#EBDDFC"/><path d="M224 84H238" stroke="#9B54EF" strokeWidth="4" strokeLinecap="round"/>
   </>}
   <circle cx="24" cy="28" r="4" fill="#1AD4F5" className="magArtPulse"/><circle cx="282" cy="45" r="5" fill="#C750EE" className="magArtPulse"/>
  </svg>
 </div>;
}

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
    <div className="signatureHeroHeading">
     <h1>Gérez mieux, <span>Décidez mieux.</span></h1>
    </div>
    <div className="signatureHeroInner">
     <div className="signatureHeroContent">
      <div className="heroContentTop">
       <p className="signatureKicker signatureKickerMoved">De la vente au suivi financier</p>
       <h2 className="heroContentHeadline">Vos opérations avancent ensemble.</h2>
       <p className="signatureHeroLead">Avec MAGNISA, chaque étape de votre activité s'inscrit dans un processus cohérent : de la gestion des clients à la facturation, des encaissements au suivi de trésorerie.</p>
       <p className="heroContentDetail">Les informations circulent entre les modules pour limiter les ressaisies, faciliter le suivi des opérations et vous offrir une lecture plus précise de la situation de votre entreprise.</p>
      </div>
      <div className="heroContentMiddle">
       <div className="signatureCtas"><Link className="signatureBtn signatureBtnPrimary" href="/signup">Commencer <ArrowRight size={17}/></Link><a className="signatureBtn signatureBtnOutline" href="#produit">Découvrir MAGNISA <span aria-hidden="true">↘</span></a></div>
      </div>
      <div className="heroContentBottom">
       <div className="signatureTrust"><ShieldCheck size={17} aria-hidden="true"/><span>Vos données professionnelles, protégées et accessibles selon les autorisations de chacun.</span></div>
       <a className="signatureExploreInline" href="#produit">EXPLORER L’UNIVERS <span aria-hidden="true">↓</span></a>
      </div>
     </div>
     <div className="signatureHeroArt">
      <div className="signatureOrbit" aria-hidden="true"></div>
      <div className="signatureVideoFrame"><div className="premiumVideoChrome" aria-hidden="true"><span className="premiumLiveDot"/> EXPÉRIENCE MAGNISA <span>GESTION & PILOTAGE</span></div>
       <video className="signatureHeroVideo" autoPlay loop muted playsInline preload="metadata" aria-label="Présentation de MAGNISA en vidéo"><source src="/VDERA.mp4" type="video/mp4"/></video>
       
      </div>
      
     </div>
    </div>
   </section>
   <section id="produit" className="signatureSection signatureProduct">
    <div className="signatureReveal motion-reveal">
     <p className="signatureLabel">UNE GESTION STRUCTURÉE, DE BOUT EN BOUT</p>
     <h2>Chaque fonction a son rôle. Toutes travaillent ensemble.</h2>
     <p className="signatureDescription">De la relation client au suivi financier, MAGNISA organise les processus essentiels de votre entreprise et relie les informations nécessaires à chaque étape de votre activité.</p>
    </div>
    <div className="signaturePillars">
     {pillars.map(({kind,label,title,text})=><article className="signaturePillar motion-reveal" key={kind}>
      <PillarIllustration kind={kind}/>
      <p className="magPillarLabel">{label}</p>
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
