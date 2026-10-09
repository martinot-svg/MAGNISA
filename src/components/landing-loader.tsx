"use client";
import Image from "next/image";
import {useEffect,useState} from "react";
export function LandingLoader(){
  const [visible,setVisible]=useState(true);
  useEffect(()=>{const t=window.setTimeout(()=>setVisible(false),850);return()=>window.clearTimeout(t)},[]);
  if(!visible)return null;
  return <div className="splash" role="status" aria-label="Chargement de MAGNISA"><div className="splashInner"><div className="splashLogo"><Image src="/magnisa-logo.png" alt="" width={140} height={140} priority/></div><div className="splashName">MAGNISA</div><div className="splashTagline">Gérez mieux. Décidez mieux.</div></div></div>
}
