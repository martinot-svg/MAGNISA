export type DocumentTheme={style:"classic"|"modern"|"minimal"|"institutional";primaryColor:string;secondaryColor:string;accentColor:string;textColor:string;headingColor:string;borderColor:string;tableHeaderColor:string;backgroundColor:string;fontFamily:"Helvetica"|"Times-Roman"|"Courier";pageMargin:number;logoPosition:"left"|"center"|"right";logoWidth:number;showPageNumbers:boolean};
export const defaultDocumentTheme:DocumentTheme={style:"classic",primaryColor:"#245cce",secondaryColor:"#526581",accentColor:"#356d9f",textColor:"#172033",headingColor:"#172033",borderColor:"#d9dee7",tableHeaderColor:"#eef2f7",backgroundColor:"#ffffff",fontFamily:"Helvetica",pageMargin:42,logoPosition:"left",logoWidth:76,showPageNumbers:true};
const hex=/^#[0-9a-fA-F]{6}$/;
export function parseDocumentTheme(value:unknown):DocumentTheme{
 const x=value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
 const output={...defaultDocumentTheme};
 for(const key of ["primaryColor","secondaryColor","accentColor","textColor","headingColor","borderColor","tableHeaderColor","backgroundColor"] as const){
  if(typeof x[key]==="string"&&hex.test(x[key]))output[key]=x[key] as string;
 }
 if(["classic","modern","minimal","institutional"].includes(String(x.style)))output.style=x.style as DocumentTheme["style"];
 if(["Helvetica","Times-Roman","Courier"].includes(String(x.fontFamily)))output.fontFamily=x.fontFamily as DocumentTheme["fontFamily"];
 if(["left","center","right"].includes(String(x.logoPosition)))output.logoPosition=x.logoPosition as DocumentTheme["logoPosition"];
 if(Number.isFinite(Number(x.pageMargin))&&Number(x.pageMargin)>=28&&Number(x.pageMargin)<=58)output.pageMargin=Number(x.pageMargin);
 if(Number.isFinite(Number(x.logoWidth))&&Number(x.logoWidth)>=40&&Number(x.logoWidth)<=120)output.logoWidth=Number(x.logoWidth);
 if(typeof x.showPageNumbers==="boolean")output.showPageNumbers=x.showPageNumbers;
 return output;
}
export function readDocumentThemeForm(fd:FormData):DocumentTheme{
 const input:Record<string,unknown>={};
 for(const k of ["style","primaryColor","secondaryColor","accentColor","textColor","headingColor","borderColor","tableHeaderColor","backgroundColor","fontFamily","pageMargin","logoPosition","logoWidth"]){input[k]=fd.get(k);}
 input.showPageNumbers=fd.get("showPageNumbers")==="on";
 for(const key of ["primaryColor","secondaryColor","accentColor","textColor","headingColor","borderColor","tableHeaderColor","backgroundColor"])if(!hex.test(String(input[key])))throw new Error("Couleur invalide : "+key);
 if(!["classic","modern","minimal","institutional"].includes(String(input.style)))throw new Error("Style inconnu");
 if(!["Helvetica","Times-Roman","Courier"].includes(String(input.fontFamily)))throw new Error("Police non prise en charge par le PDF");
 return parseDocumentTheme(input);
}
