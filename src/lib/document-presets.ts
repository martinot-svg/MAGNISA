/** Original MAGNISA document presets. No third-party assets or licenses required.
 * A preset is a visual configuration, not a fabricated business document.
 * Only document types wired to real PDF engines are exposed here.
 */
export type SupportedDocumentType="quote"|"invoice"|"payslip"|"report";
export type DocumentPreset={id:string;type:SupportedDocumentType;name:string;category:string;style:string;description:string;configuration:{primaryColor:string;secondaryColor:string;fontFamily:"Helvetica"|"Times-Roman"|"Courier";showTaxId?:boolean;showStatId?:boolean;showRegistryId?:boolean;showSlogan?:boolean;showAmountInWords?:boolean;showBankDetails?:boolean;showTaxColumn?:boolean};provenance:"MAGNISA original";license:"proprietary"};
const variants=[
 {id:"classique",name:"Classique",style:"classique",primary:"#24344a",secondary:"#66758b",font:"Helvetica"},
 {id:"moderne",name:"Moderne",style:"moderne",primary:"#1663cc",secondary:"#517dba",font:"Helvetica"},
 {id:"minimal",name:"Minimaliste",style:"minimaliste",primary:"#202c39",secondary:"#748295",font:"Helvetica"},
 {id:"institutionnel",name:"Institutionnel",style:"institutionnel",primary:"#173f58",secondary:"#537184",font:"Times-Roman"},
 {id:"premium",name:"Premium",style:"premium",primary:"#403653",secondary:"#9a7a59",font:"Times-Roman"},
 {id:"elegant",name:"Élégant",style:"élégant",primary:"#214c49",secondary:"#7a938a",font:"Times-Roman"},
 {id:"compact",name:"Compact",style:"professionnel",primary:"#394a5b",secondary:"#86929d",font:"Helvetica"},
 {id:"distinctif",name:"Distinctif",style:"créatif",primary:"#78415b",secondary:"#c08f9e",font:"Helvetica"}
] as const;
const kinds=[{type:"quote",label:"Devis",category:"Commerce et ventes"},{type:"invoice",label:"Facture",category:"Commerce et ventes"},{type:"payslip",label:"Bulletin de paie",category:"Ressources humaines et paie"},{type:"report",label:"Rapport de gestion",category:"Comptabilité et finances"}] as const;
export const DOCUMENT_PRESETS:DocumentPreset[]=kinds.flatMap(k=>variants.map(v=>({
 id:k.type+"-"+v.id,type:k.type,name:k.label+" - "+v.name,category:k.category,style:v.style,
 description:"Présentation "+v.name.toLowerCase()+" pour "+k.label.toLowerCase()+", adaptée au moteur PDF MAGNISA.",
 configuration:{primaryColor:v.primary,secondaryColor:v.secondary,fontFamily:v.font,showTaxId:true,showStatId:true,showRegistryId:true,showSlogan:true,showAmountInWords:true,showBankDetails:true,showTaxColumn:true},
 provenance:"MAGNISA original" as const,license:"proprietary" as const
})));
export function getDocumentPreset(id:string){return DOCUMENT_PRESETS.find(p=>p.id===id);}
