import type {Metadata, Viewport} from "next";
import {Inter} from "next/font/google";
import "./globals.css";
import "./magnisa-ds.css";
import "./magnisa-ds-tables.css";
import "./magnisa-neumorphism.css";
import { FormValidityGuard } from "@/components/form-validity-guard";
import { MotionReveal } from "@/components/motion-reveal";

const inter=Inter({subsets:["latin","latin-ext"],display:"swap",variable:"--font-inter"});

export const metadata:Metadata={title:{default:"MAGNISA — Gérez mieux. Décidez mieux.",template:"%s | MAGNISA"},description:"Plateforme SaaS de gestion commerciale, financière, comptable et de pilotage d'entreprise."};
export const viewport:Viewport={width:"device-width",initialScale:1,viewportFit:"cover",themeColor:"#0c1630"};

export default function RootLayout({children}:{children:React.ReactNode}){
  return <html lang="fr" className={inter.variable}><body><FormValidityGuard /><MotionReveal />{children}</body></html>;
}
