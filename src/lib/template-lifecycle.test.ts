import {describe,it,expect} from "vitest";
import {transitionTemplateStatus,TEMPLATE_STATES,TEMPLATE_ACTIONS} from "./template-lifecycle";
const expected:{from:"draft"|"in_review"|"published"|"archived";action:"submit_review"|"publish"|"archive"|"restore_draft";to?:string}[]=[
 {from:"draft",action:"submit_review",to:"in_review"},{from:"draft",action:"publish",to:"published"},{from:"draft",action:"archive",to:"archived"},{from:"draft",action:"restore_draft"},
 {from:"in_review",action:"submit_review"},{from:"in_review",action:"publish",to:"published"},{from:"in_review",action:"archive",to:"archived"},{from:"in_review",action:"restore_draft",to:"draft"},
 {from:"published",action:"submit_review"},{from:"published",action:"publish"},{from:"published",action:"archive",to:"archived"},{from:"published",action:"restore_draft"},
 {from:"archived",action:"submit_review"},{from:"archived",action:"publish"},{from:"archived",action:"archive"},{from:"archived",action:"restore_draft",to:"draft"}
];
describe("Cycle de vie des modèles officiels",()=>{
 it("inclut 4 statuts et 4 actions",()=>{expect(TEMPLATE_STATES).toHaveLength(4);expect(TEMPLATE_ACTIONS).toHaveLength(4)});
 for(const e of expected)it(e.from+" + "+e.action,()=>{if(e.to)expect(transitionTemplateStatus(e.from,e.action)).toBe(e.to);else expect(()=>transitionTemplateStatus(e.from,e.action)).toThrow()});
 it("impose une revue avant publication si configurée",()=>expect(()=>transitionTemplateStatus("draft","publish",true)).toThrow());
 it("permet de publier après revue",()=>expect(transitionTemplateStatus("in_review","publish",true)).toBe("published"));
 it("la restauration d'un modèle archivé repasse en brouillon",()=>expect(transitionTemplateStatus("archived","restore_draft")).toBe("draft"));
});
