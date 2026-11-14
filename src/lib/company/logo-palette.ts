type RGB = { r: number; g: number; b: number; count: number };
const toHex = (r:number,g:number,b:number) =>
  "#" + [r,g,b].map(value => Math.min(255,Math.max(0,Math.round(value))).toString(16).padStart(2,"0")).join("").toUpperCase();
export type LogoPalette = { primaryColor:string; secondaryColor:string; accentColor:string };

/** Extract a small set of representative, saturated logo colours.
 * Ignores transparency and near-white/black backgrounds.
 * This is an initial suggestion, not a guaranteed brand manual. */
export function paletteFromRgba(pixels: Uint8ClampedArray): LogoPalette {
  const bins = new Map<string,RGB>();
  for(let i=0;i<pixels.length;i+=4) {
    const [r,g,b,a] = [pixels[i],pixels[i+1],pixels[i+2],pixels[i+3]];
    if(a < 120)continue;
    const top=Math.max(r,g,b), bottom=Math.min(r,g,b);
    if(top > 245 && bottom > 232)continue;
    if(top < 38)continue;
    if(top - bottom < 22)continue;
    const x = [r,g,b].map(v=>Math.round(v/24)*24);
    const key=x.join(",");
    const current=bins.get(key)||{r:0,g:0,b:0,count:0};
    current.r+=r;current.g+=g;current.b+=b;current.count++;
    bins.set(key,current);
  }
  const winners=[...bins.values()].sort((a,b)=>b.count-a.count).slice(0,6)
    .map(c=>toHex(c.r/c.count,c.g/c.count,c.b/c.count));
  return {
    primaryColor:winners[0]||"#1663FF",
    secondaryColor:winners.find(c=>c!==winners[0])||"#7B4DFF",
    accentColor:winners[2]||"#D93CFF",
  };
}

export async function extractLogoPalette(file:File):Promise<LogoPalette> {
  const bitmap=await createImageBitmap(file);
  try {
    const canvas=document.createElement("canvas");
    canvas.width=64;canvas.height=64;
    const context=canvas.getContext("2d",{willReadFrequently:true});
    if(!context)throw new Error("Canvas unavailable");
    context.drawImage(bitmap,0,0,64,64);
    return paletteFromRgba(context.getImageData(0,0,64,64).data);
  } finally { bitmap.close(); }
}
export const LOGO_MIME_EXT:Record<string,string>={
  "image/png":"png","image/jpeg":"jpg","image/webp":"webp"
};
export async function validLogoFile(file: File): Promise<boolean> {
  if(!LOGO_MIME_EXT[file.type]) return false;
  const b=new Uint8Array(await file.slice(0,16).arrayBuffer());
  if(file.type==="image/png")return [137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v);
  if(file.type==="image/jpeg")return b[0]===255&&b[1]===216&&b[2]===255;
  return String.fromCharCode(...b.slice(0,4))==="RIFF" && String.fromCharCode(...b.slice(8,12))==="WEBP";
}
