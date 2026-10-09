const units=["zéro","un","deux","trois","quatre","cinq","six","sept","huit","neuf","dix","onze","douze","treize","quatorze","quinze","seize"];
function under100(n:number):string{
  if(n<17)return units[n];
  if(n<20)return `dix-${units[n-10]}`;
  const tens=Math.floor(n/10),u=n%10;
  if(tens===7)return u===1?"soixante et onze":`soixante-${under100(10+u)}`;
  if(tens===9)return `quatre-vingt-${under100(10+u)}`;
  const names:Record<number,string>={2:"vingt",3:"trente",4:"quarante",5:"cinquante",6:"soixante",8:"quatre-vingt"};
  const base=names[tens];
  if(!u)return tens===8?"quatre-vingts":base;
  if(u===1&&tens!==8)return `${base} et un`;
  return `${base}-${units[u]}`;
}
function under1000(n:number):string{
  if(n<100)return under100(n);
  const h=Math.floor(n/100),r=n%100;
  const head=h===1?"cent":`${units[h]} cent${r===0&&h>1?"s":""}`;
  return r?`${head} ${under100(r)}`:head;
}
function integerWords(value:number):string{
  const n=Math.trunc(value);
  if(n===0)return "zéro";
  if(n<0)return `moins ${integerWords(-n)}`;
  const scales=[
    {v:1_000_000_000_000,name:"billion",plural:"billions"},
    {v:1_000_000_000,name:"milliard",plural:"milliards"},
    {v:1_000_000,name:"million",plural:"millions"},
    {v:1_000,name:"mille",plural:"mille"}
  ];
  let rest=n;const parts:string[]=[];
  for(const s of scales){
    const q=Math.floor(rest/s.v);if(!q)continue;
    if(s.v===1000){parts.push(q===1?"mille":`${integerWords(q)} mille`)}else{parts.push(`${integerWords(q)} ${q>1?s.plural:s.name}`)}
    rest%=s.v;
  }
  if(rest)parts.push(under1000(rest));
  return parts.join(" ");
}
export function amountInWords(amount:number,currency="MGA"){
  const rounded=Math.round((amount+Number.EPSILON)*100)/100;
  const whole=Math.trunc(rounded);const cents=Math.round((rounded-whole)*100);
  const cur=currency.toUpperCase()==="MGA"?(Math.abs(whole)>1?"Ariary":"Ariary"):currency.toUpperCase();
  const main=`${integerWords(whole)} ${cur}`;
  return cents?`${main} et ${integerWords(cents)} centièmes`:main;
}
