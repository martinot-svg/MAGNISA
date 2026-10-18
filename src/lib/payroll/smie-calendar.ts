export type SmieDeadline={quarter:number;period:string;windowStart:string;windowEnd:string};
export function smieDeadlines(year:number):SmieDeadline[]{
 if(!Number.isInteger(year)||year<2000||year>2100)throw new Error("Année invalide");
 return [1,2,3,4].map(quarter=>{
  const startMonth=(quarter-1)*3+1;
  const period=`${year}-${String(startMonth).padStart(2,"0")}-01 au ${year}-${String(startMonth+2).padStart(2,"0")}-${new Date(Date.UTC(year,startMonth+2,0)).getUTCDate()}`;
  const month=quarter===4?1:quarter*3+1;
  const nextYear=quarter===4?year+1:year;
  return {quarter,period,windowStart:`${nextYear}-${String(month).padStart(2,"0")}-01`,windowEnd:`${nextYear}-${String(month).padStart(2,"0")}-${new Date(Date.UTC(nextYear,month,0)).getUTCDate()}`};
 });
}
