"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { signupEmailPolicy } from "@/lib/auth/domain";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidRegistrationLocality, normalizeUsername, USERNAME_PATTERN } from "@/lib/auth/magnisa-identity";
import { createHmac } from "node:crypto";
import { headers } from "next/headers";

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(10),
  full_name: z.string().trim().min(2).max(120),
  username: z.string().trim().min(3).max(30),
  country_code: z.string().regex(/^[0-9]{3}$/),
  locality_code: z.string().regex(/^[0-9]{3}$/),
});

export async function signUp(formData: FormData) {
  const parsed = signupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: "Adresse e-mail ou mot de passe invalide. Le mot de passe doit comporter au moins 10 caractères." };
  }

  const username = normalizeUsername(parsed.data.username);
  if (!USERNAME_PATTERN.test(username)) {
    return { error: "Le nom d’utilisateur doit avoir 3 à 30 caractères (lettres minuscules, chiffres, points ou _)." };
  }
  if (!isValidRegistrationLocality(parsed.data.country_code, parsed.data.locality_code)) {
    return { error: "Sélectionne une localité d’inscription proposée par MAGNISA." };
  }

  const policy = signupEmailPolicy(parsed.data.email);
  if (!policy.ok) return { error: policy.reason };

  const email = policy.normalized!;
  const supabase = await createClient();
  // Validation serveur uniquement : pas d'accès direct des visiteurs à l'annuaire des comptes.
  const admin = createAdminClient();
  const { data: taken, error: checkError } = await admin.from("profiles")
    .select("id").eq("username", username).maybeSingle();
  if (checkError) return { error: "Vérification du nom d’utilisateur indisponible." };
  if (taken) return { error: "Ce nom d’utilisateur est déjà utilisé. Choisis-en un autre." };

  const { data, error } = await supabase.auth.signUp({
    email,
    password: parsed.data.password,
    options: { data: {
      full_name: parsed.data.full_name.trim(),
      username,
    } },
  });

  if (error) {
    const message = error.message.toLowerCase();
    if (message.includes("already") || message.includes("registered")) {
      return { error: "Un compte existe déjà avec cette adresse e-mail." };
    }
    return { error: "Impossible de créer le compte. Réessaie dans quelques instants." };
  }

  if (!data.user) return { error: "Création du compte impossible." };

  // Auth user_metadata is readable by the user: NEVER store geographic codes there.
  // The server calls a service-role-only RPC to attach the immutable origin privately.
  if (data.user.email?.trim().toLowerCase() === email && data.user.id) {
    const { error: originError } = await admin.rpc("register_magnisa_signup_origin", {
      p_user: data.user.id,
      p_country: parsed.data.country_code,
      p_locality: parsed.data.locality_code,
    });
    if (originError) {
      // Do not invalidate an already-created Supabase Auth account. The user can
      // complete the origin from /mon-profil after confirming the email.
      console.error("[magnisa-identity] Origin registration pending:", originError.code);
    }
  }

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
  const parsed = z.object({
    identifier: z.string().trim().min(3).max(254),
    password: z.string().min(1),
  }).safeParse({ identifier: formData.get("identifier") ?? formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: "Identifiants invalides." };

  const identifier = parsed.data.identifier.trim().toLowerCase();
  let email = identifier;
  if (!identifier.includes("@")) {
    if (!USERNAME_PATTERN.test(identifier)) {
      return { error: "Connexion impossible. Vérifie tes identifiants." };
    }
    try {
      const admin = createAdminClient();
      // Shared, atomic rate limit before username lookup. Never expose the email.
      const requestHeaders = await headers();
      const ip = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
      const secret = process.env.SUPABASE_SERVICE_ROLE_KEY!;
      const fingerprint = createHmac("sha256", secret).update(ip + ":" + identifier).digest("hex");
      const { data: allowed, error: throttleError } = await admin.rpc("consume_magnisa_username_login_attempt", {
        p_fingerprint: fingerprint,
      });
      if (throttleError || allowed !== true) {
        return { error: "Connexion temporairement limitée. Réessaie plus tard." };
      }
      const { data: profile, error: lookupError } = await admin.from("profiles")
        .select("email").eq("username", identifier).maybeSingle();
      if (lookupError || !profile) {
        return { error: "Connexion impossible. Vérifie tes identifiants." };
      }
      email = profile.email;
    } catch {
      return { error: "Connexion impossible. Réessaie plus tard." };
    }
  } else if (!z.email().safeParse(identifier).success) {
    return { error: "Connexion impossible. Vérifie tes identifiants." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password: parsed.data.password });
  if (error) return { error: "Connexion impossible. Vérifie tes identifiants." };
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
