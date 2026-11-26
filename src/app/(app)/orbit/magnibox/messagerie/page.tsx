import { MagniboxInternalContent } from "@/components/magnibox-internal-workspace";
import { MagniboxInternetWorkspace } from "@/components/magnibox-internet-workspace";
export default async function MagniboxMessagingPage({ searchParams }: { searchParams?: Promise<{ q?: string | string[]; folder?: string | string[] }> }) {
 const params=searchParams?await searchParams:{};
 const searchQuery=Array.isArray(params.q)?params.q[0]||"":params.q||"";
 const selectedFolderId=Array.isArray(params.folder)?params.folder[0]||"":params.folder||"";
 return <><div className="pageHead"><div><p className="eyebrow">MAGNIBOX · Communication</p><h1>Messagerie</h1><p>Messages internes, courrier connecté, recherche et brouillons.</p></div></div><MagniboxInternalContent embedded searchQuery={searchQuery} selectedFolderId={selectedFolderId}/><MagniboxInternetWorkspace/></>;
}