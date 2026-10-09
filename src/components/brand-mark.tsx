import Image from "next/image";
import Link from "next/link";
export function BrandMark({href="/",compact=false}:{href?:string;compact?:boolean}){
  const content=<span className={compact?"brandMark compact":"brandMark"}><span className="brandLogoWrap"><Image src="/magnisa-logo.png" alt="MAGNISA" width={compact?38:48} height={compact?38:48} priority/></span><span className="brandWords"><strong>MAGNISA</strong><small>Gérez mieux. Décidez mieux.</small></span></span>;
  return href?<Link href={href} aria-label="MAGNISA">{content}</Link>:content;
}
