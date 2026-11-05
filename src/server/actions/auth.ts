"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { signupEmailPolicy } from "@/lib/auth/domain";

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(10),
});

export async function signUp(formData: FormData) {
  const parsed = signupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: "Adresse e-mail ou mot de passe invalide. Le mot de passe doit comporter au moins 10 caractères." };
  }

  const policy = signupEmailPolicy(parsed.data.email);
  if (!policy.ok) return { error: policy.reason };

  const email = policy.normalized!;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password: parsed.data.password,
  });

  if (error) {
    const message = error.message.toLowerCase();
    if (message.includes("already") || message.includes("registered")) {
      return { error: "Un compte existe déjà avec cette adresse e-mail." };
    }
    return { error: "Impossible de créer le compte. Réessaie dans quelques instants." };
  }

  if (!data.user) return { error: "Création du compte impossible." };

  return {
    success: "Un code de vérification à 6 chiffres a été envoyé par e-mail.",
    email,
  };
}

export async function verifyEmailCode(formData: FormData) {
  const parsed = z.object({
    email: z.string().email(),
    code: z.string().regex(/^\d{6}$/),
  }).safeParse(Object.fromEntries(formData));

  if (!parsed.success) return { error: "Saisis le code à 6 chiffres reçu par e-mail." };

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    email: parsed.data.email.trim().toLowerCase(),
    token: parsed.data.code,
    type: "email",
  });

  if (error) return { error: "Code invalide ou expiré. Vérifie le code ou demande un nouvel envoi." };

  redirect("/onboarding");
}

export async function resendEmailCode(formData: FormData) {
  const parsed = z.object({ email: z.string().email() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Adresse e-mail invalide." };

  const email = parsed.data.email.trim().toLowerCase();
  const supabase = await createClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
  });

  if (error) {
    if (error.message.toLowerCase().includes("rate")) {
      return { error: "Patiente environ 60 secondes avant de demander un nouveau code." };
    }
    return { error: "Impossible de renvoyer le code pour le moment." };
  }

  return { success: "Un nouveau code à 6 chiffres a été envoyé." };
}

export async function signIn(formData: FormData) {
  const parsed = z.object({ email: z.string().email(), password: z.string().min(1) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Identifiants invalides." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email.trim().toLowerCase(),
    password: parsed.data.password,
  });

  if (error) return { error: "Connexion impossible. Vérifie tes identifiants et la confirmation de l'adresse." };
  redirect("/dashboard");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}

export async function requestPasswordReset(formData: FormData) {
  const parsed = z.object({ email: z.string().email() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Adresse e-mail invalide." };

  const supabase = await createClient();
  const origin = process.env.NEXT_PUBLIC_APP_URL;
  if (!origin) return { error: "NEXT_PUBLIC_APP_URL n'est pas configurée." };

  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email.trim().toLowerCase(), {
    redirectTo: `${origin}/auth/callback?next=/reset-password`,
  });

  if (error) return { error: "Impossible d'envoyer le lien de réinitialisation." };
  return { success: "Si cette adresse correspond à un compte, un lien de réinitialisation a été envoyé." };
}

export async function updatePassword(formData: FormData) {
  const parsed = z.object({ password: z.string().min(10), confirm: z.string().min(10) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success || parsed.data.password !== parsed.data.confirm) {
    return { error: "Les mots de passe doivent correspondre et comporter au moins 10 caractères." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: "Impossible de modifier le mot de passe." };
  return { success: "Mot de passe modifié. Tu peux continuer à utiliser MAGNISA." };
}
