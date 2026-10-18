/** Format amounts for PDFs using plain spaces, avoiding locale NBSP glyph issues. */
export function formatDocumentAmount(value:number,opts:{currency?:string;decimals?:0|2;showZeroDecimals?:boolean}={}):string{
 if(!Number.isFinite(value))throw new Error("Montant invalide");
 const digits=opts.decimals??2;
 const rounded=Math.round((Math.abs(value)+Number.EPSILON)*10**digits)/10**digits;
 const fixed=rounded.toFixed(digits),[whole,dec]=fixed.split(".");
 const grouped=whole.replace(/\B(?=(\d{3})+(?!\d))/g," ");
 const fractional=digits===2&&(opts.showZeroDecimals||dec!=="00")?","+dec:"";
 return (value<0&&rounded!==0?"-":"")+grouped+fractional+(opts.currency?" "+opts.currency:"");
}
