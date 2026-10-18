import {describe,it,expect} from "vitest";
import {parseDocumentTheme,defaultDocumentTheme} from "./document-theme";
describe("Charte documentaire multi-entreprise",()=>{
 it("garantit des défauts valides",()=>expect(parseDocumentTheme(null)).toEqual(defaultDocumentTheme));
 it("conserve les couleurs PDF valides",()=>expect(parseDocumentTheme({primaryColor:"#112233",fontFamily:"Courier",pageMargin:36})).toMatchObject({primaryColor:"#112233",fontFamily:"Courier",pageMargin:36}));
 it("rejette les couleurs CSS dangereuses",()=>expect(parseDocumentTheme({primaryColor:"red;url(javascript:alert(1))"}).primaryColor).toBe(defaultDocumentTheme.primaryColor));
 it("borne les marges et le logo",()=>expect(parseDocumentTheme({pageMargin:999,logoWidth:-5})).toMatchObject({pageMargin:42,logoWidth:76}));
 it("ignore les polices non prises en charge",()=>expect(parseDocumentTheme({fontFamily:"Comic Sans MS"}).fontFamily).toBe("Helvetica"));
});
