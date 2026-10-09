import type {Metadata} from "next";
import "./globals.css";
export const metadata:Metadata={title:{default:"MAGNISA — Gérez mieux. Décidez mieux.",template:"%s | MAGNISA"},description:"Plateforme SaaS de gestion commerciale, financière, comptable et de pilotage d'entreprise."};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="fr"><body>{children}</body></html>}
