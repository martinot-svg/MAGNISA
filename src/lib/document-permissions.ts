/** Document access is separate from payment, validation and payroll calculation rights. */
export const DOCUMENT_PERMISSIONS=["templates.view","templates.create","templates.edit_own","templates.edit_shared","templates.publish","templates.archive","templates.delete","templates.set_default","branding.view","branding.edit","branding.logo_manage","documents.preview","documents.generate","documents.export","documents.print","documents.history.view","permissions.manage"] as const;
export type DocumentPermission=typeof DOCUMENT_PERMISSIONS[number];
export type DocumentScope="quote"|"invoice"|"payslip"|"report";
const all=new Set<DocumentPermission>(DOCUMENT_PERMISSIONS);
const templateViewer=["templates.view","branding.view","documents.preview"] as const;
const maker=[...templateViewer,"templates.create","templates.edit_own","documents.generate","documents.export","documents.print","documents.history.view"] as const;
const defaults:Record<string,ReadonlySet<DocumentPermission>>={
 owner:all,admin:all,
 director:new Set(maker),finance_manager:new Set(maker),accountant:new Set(maker),hr:new Set(maker),
 sales:new Set([...templateViewer,"documents.generate","documents.export","documents.print"]),
 cashier:new Set(templateViewer),employee:new Set(templateViewer),auditor:new Set([...templateViewer,"documents.history.view"]),viewer:new Set(["templates.view","branding.view"])
};
export function roleDocumentPermission(role:string,permission:DocumentPermission){return !!defaults[role]?.has(permission);}
export function roleDocumentScope(role:string,scope:DocumentScope){
 if(["owner","admin"].includes(role))return true;
 if(role==="hr")return scope==="payslip";
 if(["finance_manager","accountant","director"].includes(role))return scope!=="payslip";
 if(["sales","cashier"].includes(role))return ["quote","invoice"].includes(scope);
 if(role==="auditor")return scope!=="payslip";
 return false;
}
export async function canDocumentAction(ctx:{supabase:any;organizationId:string;role:string;user?:{id:string}},permission:DocumentPermission,scope:DocumentScope){
 if(!roleDocumentScope(ctx.role,scope))return false;
 const {data,error}=await ctx.supabase.from("role_permissions").select("allowed").eq("organization_id",ctx.organizationId).eq("role",ctx.role).eq("permission_key",permission).maybeSingle();
 if(error)throw new Error("Échec de contrôle des droits documentaires.");
 const roleAllowed=data?data.allowed===true:roleDocumentPermission(ctx.role,permission);
 if(!roleAllowed)return false;
 if(!ctx.user?.id)return roleAllowed;
 const {data:override,error:overrideError}=await ctx.supabase.from("user_document_permissions").select("allowed").eq("organization_id",ctx.organizationId).eq("user_id",ctx.user.id).eq("permission_key",permission).maybeSingle();
 if(overrideError)throw new Error("Vérification des droits individuels impossible.");
 return override?override.allowed===true:roleAllowed;
}
export async function assertDocumentAction(ctx:{supabase:any;organizationId:string;role:string},permission:DocumentPermission,scope:DocumentScope){
 if(!(await canDocumentAction(ctx,permission,scope)))throw new Error("Accès documentaire refusé.");
}
