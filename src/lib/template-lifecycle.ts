export type TemplateStatus="draft"|"in_review"|"published"|"archived";
export type TemplateAction="submit_review"|"publish"|"archive"|"restore_draft";
const transitions:Record<TemplateStatus,Partial<Record<TemplateAction,TemplateStatus>>>={
 draft:{submit_review:"in_review",publish:"published",archive:"archived"},
 in_review:{publish:"published",archive:"archived",restore_draft:"draft"},
 published:{archive:"archived"},
 archived:{restore_draft:"draft"}
};
export function transitionTemplateStatus(from:TemplateStatus,action:TemplateAction,requireReview=false):TemplateStatus{
 if(requireReview&&from==="draft"&&action==="publish")throw new Error("La revue est obligatoire avant publication.");
 const next=transitions[from]?.[action];
 if(!next)throw new Error("Transition de modèle interdite.");
 return next;
}
export const TEMPLATE_STATES=["draft","in_review","published","archived"] as const;
export const TEMPLATE_ACTIONS=["submit_review","publish","archive","restore_draft"] as const;
