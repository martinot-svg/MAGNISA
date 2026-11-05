"use server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
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
    email: z���q�^