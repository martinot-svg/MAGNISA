"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { signupEmailPolicy } from "@/lib/auth/domain";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidRegistrationRegion, REGISTRATION_REGIONS, normalizeUsername, USERNAME_PATTERN, NEW_USERNAME_PATTERN, LEGACY_GENERATED_USERNAME_PATTERN, usernameVariants } from "@/lib/auth/magnisa-identity";
import { createHmac } from "node:crypto";
import { resolveLocality } from "@/lib/geo/madagascar-localities";
import { headers } from "next/headers";
import { isAtLeast18, isValidBirthDate } from "@/lib/auth/majority";
import { normalizeSignupPhone, SIGNUP_PHONE_COUNTRIES } from "@/lib/auth/phone";

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(10),
  first_name: z.string().trim().min(1).max(60),
  last_name: z.string().trim().min(1).max(60),
  username: z.string().trim().min(3).max(11),
  confirm_password: z.string().min(10),
    birth_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  majority_confirmed: z.literal("true"),
  residence_country_iso2: z.string().regex(/^[A-Z]{2}$/),
  residence_country_name: z.string().trim().min(2).max(100),
  residence_region_name: z.string().trim().min(1).max(120),
  residence_region_code: z.string().regex(/^9[0-2][0-9]$/).optional().or(z.literal("")),
  residence_locality_name: z.string().trim().min(2).max(160),
  residence_locality_ref: z.string().trim().max(40).optional(),
  phone_country: z.string().length(2),
  phone_prefix: z.string().max(3).optional(),
  phone_national: z.string().regex(/^[0-9]{4,14}$/).optional(),
});

export async function signUp(formData: FormData) {
  const parsed = signupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: "Adresse e-mail ou mot de passe invalide. Le mot de passe doit comporter au moins 10 caractères." };
  }

  const phone = normalizeSignupPhone(parsed.data.phone_country, parsed.data.phone_prefix || "", parsed.data.phone_national || "");
  if (!phone) return { error: "Le numéro de téléphone est invalide pour le pays et le préfixe sélectionnés." };

  const username = normalizeUsername(parsed.data.username);
  const fullName = `${parsed.data.first_name} ${parsed.data.last_name}`.trim();
  if (parsed.data.password !== parsed.data.confirm_password) return { error: "Les mots de passe ne correspondent pas." };
  if (!isValidBirthDate(parsed.data.birth_date) || !isAtLeast18(parsed.data.birth_date)) {
    return { error: "Tu dois avoir au moins 18 ans pour créer un compte MAGNISA." };
  }
  if (!NEW_USERNAME_PATTERN.test(username)) {
    return { error: "Le nom d’utilisateur doit comporter de 3 à 10 lettres minuscules après @." };
  }
  const residenceCountry = SIGNUP_PHONE_COUNTRIES.find(item => item.iso2 === parsed.data.residence_country_iso2);
  if (!residenceCountry) return { error: "Sélectionne un pays de résidence valide." };
  const officialCountryName = new Intl.DisplayNames(["fr"], { type: "region" }).of(parsed.data.residence_country_iso2);
  if (!officialCountryName || officialCountryName === parsed.data.residence_country_iso2 ||
      officialCountryName !== parsed.data.residence_country_name) {
    return { error: "Le pays de résidence sélectionné est invalide." };
  }
  if (parsed.data.residence_country_iso2 === "MG") {
    if (!parsed.data.residence_region_code ||
        !isValidRegistrationRegion("261", parsed.data.residence_region_code) ||
        REGISTRATION_REGIONS.find(item => item.code === parsed.data.residence_region_code)?.name !== parsed.data.residence_region_name) {
      return { error: "Sélectionne une région valide de Madagascar." };
    }
  } else if (parsed.data.residence_region_code) {
    return { error: "La région sélectionnée ne correspond pas au pays de résidence." };
  }
  const chosen = parsed.data.residence_country_iso2 === "MG"
    ? resolveLocality(parsed.data.residence_locality_ref || "", parsed.data.residence_region_code || "")
    : null;
  const normalizedPlace = parsed.data.residence_locality_name.trim().toLocaleLowerCase("fr");
  const validated = chosen?.name.toLocaleLowerCase("fr") === normalizedPlace ? chosen : null;

  const policy = signupEmailPolicy(parsed.data.email);
  if (!policy.ok) return { error: policy.reason };

  const email = policy.normalized!;
  const supabase = await createClient();
  // Preflight improves the collision message; the database trigger also checks
  // and reserves the requested username atomically to close concurrency races.
  const admin = createAdminClient();
  const { data: taken, error: checkError } = await admin.from("profiles")
    .select("id").eq("username", username).maybeSingle();
  if (checkError) return { error: "Vérification du nom d’utilisateur indisponible." };
  if (taken) {
    const variants = usernameVariants(username).slice(0, 120);
    const { data: occupied, error: suggestionsError } = await admin.from("profiles")
      .select("username").in("username", variants);
    const occupiedNames = new Set((occupied || []).map(item => item.username));
    return {
      error: "Ce nom d’utilisateur est déjà utilisé. Choisis un autre nom ci-dessous.",
      suggestions: suggestionsError ? [] : variants.filter(item => !occupiedNames.has(item)).slice(0, 3),
    };
  }

  const { error: existingEmailError, data: existingEmail } = await admin.from("profiles")
    .select("id").eq("email", email).maybeSingle();
  if (existingEmailError) return { error: "Vérification du compte indisponible. Réessaie." };
  if (existingEmail) return { error: "Un compte existe déjà avec cette adresse e-mail." };

  const { error: ageStageError } = await admin.rpc("stage_magnisa_signup_age", {
    p_email: email, p_birth_date: parsed.data.birth_date, p_majority_confirmed: true,
  });
  if (ageStageError) return { error: "Impossible de sécuriser la vérification de majorité. Réessaie." };

  const { data, error } = await supabase.auth.signUp({
    email,
    password: parsed.data.password,
    options: { data: {
      full_name: fullName,
      given_names: parsed.data.first_name.trim(),
      family_name: parsed.data.last_name.trim(),
      username,
    } },
  });

  if (error) {
    await admin.rpc("cancel_magnisa_signup_age_pending", { p_email: email });
    const message = error.message.toLowerCase();
    if (message.includes("already") || message.includes("registered")) {
      return { error: "Un compte existe déjà avec cette adresse e-mail." };
    }
    return { error: "Impossible de créer le compte. Réessaie dans quelques instants." };
  }

  if (!data.user) {
    await admin.rpc("cancel_magnisa_signup_age_pending", { p_email: email });
    return { error: "Création du compte impossible." };
  }
  // Supabase can return a synthetic identity for an existing email.
  if (Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    await admin.rpc("cancel_magnisa_signup_age_pending", { p_email: email });
    return { error: "Un compte existe déjà avec cette adresse e-mail." };
  }
  if (!data.user.id) {
    await admin.rpc("cancel_magnisa_signup_age_pending", { p_email: email });
    return { error: "Création du compte impossible." };
  }

  const { error: phoneError } = await admin.rpc("register_magnisa_signup_phone", {
    p_user: data.user.id, p_phone_e164: phone.e164, p_country_iso2: phone.country,
  });
  const { data: storedPhone, error: phoneReadError } = await admin.rpc("get_magnisa_signup_phone", { p_user: data.user.id });
  if (phoneError || phoneReadError || !Array.isArray(storedPhone) || storedPhone[0]?.phone_e164 !== phone.e164 || storedPhone[0]?.country_iso2 !== phone.country) {
    const { error: rollbackError } = await admin.auth.admin.deleteUser(data.user.id);
    await admin.rpc("cancel_magnisa_signup_age_pending", { p_email: email });
    console.error("[magnisa-signup] Phone persistence failed:", phoneError?.code || phoneReadError?.code || "read-back-mismatch", rollbackError?.message || "");
    return { error: "Impossible d’enregistrer le numéro de téléphone. Aucun compte n’a été créé ; réessaie." };
  }

  // Residence is editable profile data, never the immutable registration origin.
  // It is stored in its own private table and never copied into Auth user_metadata.
  const { error: residenceError } = await admin.rpc("register_magnisa_signup_residence", {
    p_user: data.user.id,
    p_country_iso2: parsed.data.residence_country_iso2,
    p_country_name: officialCountryName,
    p_region_name: parsed.data.residence_region_name,
    p_locality_name: parsed.data.residence_locality_name,
    p_locality_ref: validated?.ref || null,
  });
  const { data: storedResidence, error: residenceReadError } = await admin.rpc(
    "get_magnisa_signup_residence_for_service", { p_user: data.user.id },
  );
  if (residenceError || residenceReadError ||
      !Array.isArray(storedResidence) ||
      storedResidence[0]?.country_iso2 !== parsed.data.residence_country_iso2 ||
      storedResidence[0]?.region_name !== parsed.data.residence_region_name ||
      storedResidence[0]?.locality_name !== parsed.data.residence_locality_name) {
    const { error: rollbackError } = await admin.auth.admin.deleteUser(data.user.id);
    await admin.rpc("cancel_magnisa_signup_age_pending", { p_email: email });
    console.error("[magnisa-signup] Residence persistence failed:", residenceError?.code || residenceReadError?.code || "read-back-mismatch", rollbackError?.message || "");
    return { error: "Impossible d’enregistrer votre lieu de résidence. Aucun compte n’a été créé ; réessaie." };
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
    identifier: z.string().trim().min(2).max(254),
    password: z.string().min(1),
  }).safeParse({ identifier: formData.get("identifier") ?? formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: "Identifiants invalides." };

  const identifier = parsed.data.identifier.trim().toLowerCase();
  const isEmail = identifier.includes("@") && !identifier.startsWith("@");
  const handle = normalizeUsername(identifier);
  let email = identifier;
  if (!isEmail) {
    // Accept both current handles (3-10, lowercase letters) and legacy generated ones (2-10).
    if (!USERNAME_PATTERN.test(handle) && !LEGACY_GENERATED_USERNAME_PATTERN.test(handle)) {
      return { error: "Connexion impossible. Vérifie tes identifiants." };
    }
    try {
      const admin = createAdminClient();
      // Shared, atomic rate limit before username lookup. Never expose the email.
      const requestHeaders = await headers();
      const ip = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
      const secret = process.env.SUPABASE_SERVICE_ROLE_KEY!;
      const fingerprint = createHmac("sha256", secret).update(ip + ":" + handle).digest("hex");
      const { data: allowed, error: throttleError } = await admin.rpc("consume_magnisa_username_login_attempt", {
        p_fingerprint: fingerprint,
      });
      if (throttleError || allowed !== true) {
        return { error: "Connexion temporairement limitée. Réessaie plus tard." };
      }
      const { data: profile, error: lookupError } = await admin.from("profiles")
        .select("email").eq("username", handle).maybeSingle();
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

export async function verifyMajorityForExistingAccount(
  _: { error?: string }, formData: FormData,
): Promise<{ error?: string }> {
  const parsed = z.object({
    birth_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    majority_confirmed: z.literal("true"),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success || !isValidBirthDate(parsed.data?.birth_date || "") ||
      !isAtLeast18(parsed.data?.birth_date || "")) {
    return { error: "Une date de naissance valide et la confirmation de majorité sont requises (18 ans minimum)." };
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!user.email_confirmed_at) redirect(`/verify-email?email=${encodeURIComponent(user.email || "")}`);
  const admin = createAdminClient();
  const { error } = await admin.rpc("register_magnisa_signup_age", {
    p_user: user.id, p_birth_date: parsed.data.birth_date, p_majority_confirmed: true,
  });
  if (error) return { error: "Impossible d'enregistrer la vérification de majorité. Réessaie." };
  redirect("/onboarding");
}
