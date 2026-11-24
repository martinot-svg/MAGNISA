"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrganization } from "@/lib/current-org";
import { assertPermission } from "@/lib/permissions";

const timezone = z.string().trim().min(3).max(100);
const resourceType = z.enum(["room","vehicle","equipment","staff","other"]);

export async function createReservableResource(formData: FormData) {
  const ctx = await requireOrganization();
  await assertPermission(ctx, "orders.manage");
  const raw: Record<string, unknown> = Object.fromEntries(formData);
  if (raw.capacity === "") raw.capacity = undefined;
  const parsed = z.object({
    name: z.string().trim().min(2).max(180),
    resource_type: resourceType,
    description: z.string().trim().max(2000).optional(),
    capacity: z.coerce.number().int().positive().optional().or(z.literal("")),
  }).safeParse(raw);
  if (!parsed.success) throw new Error("Informations de ressource invalides.");
  const { error } = await ctx.supabase.rpc("create_reservable_resource", {
    p_org: ctx.organizationId,
    p_name: parsed.data.name,
    p_type: parsed.data.resource_type,
    p_description: parsed.data.description || null,
    p_capacity: parsed.data.capacity === "" || parsed.data.capacity === undefined ? null : Number(parsed.data.capacity),
  });
  if (error) throw new Error("Création de ressource impossible : " + error.message);
  revalidatePath("/reservations");
}

function parseDateWithOffset(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new Error(field + " doit contenir un fuseau horaire explicite, par exemple 2026-12-01T09:00:00+03:00.");
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(field + " est invalide.");
  return date.toISOString();
}

export async function createResourceReservation(formData: FormData) {
  const ctx = await requireOrganization();
  await assertPermission(ctx, "orders.manage");
  const raw = Object.fromEntries(formData);
  const parsed = z.object({
    resource_id: z.string().uuid(),
    customer_id: z.string().uuid().optional().or(z.literal("")),
    service_id: z.string().uuid().optional().or(z.literal("")),
    timezone_name: timezone,
    idempotency_key: z.string().uuid(),
    notes: z.string().trim().max(4000).optional(),
  }).safeParse(raw);
  if (!parsed.success) throw new Error("Informations de réservation invalides.");
  const start = parseDateWithOffset(raw.start_at, "Début");
  const end = parseDateWithOffset(raw.end_at, "Fin");
  if (new Date(end) <= new Date(start)) throw new Error("La fin doit être postérieure au début.");
  const { error } = await ctx.supabase.rpc("create_resource_reservation", {
    p_org: ctx.organizationId,
    p_resource: parsed.data.resource_id,
    p_customer: parsed.data.customer_id || null,
    p_service: parsed.data.service_id || null,
    p_start_at: start,
    p_end_at: end,
    p_timezone: parsed.data.timezone_name,
    p_idempotency_key: parsed.data.idempotency_key,
    p_notes: parsed.data.notes || null,
  });
  if (error) throw new Error("Réservation impossible : " + error.message);
  revalidatePath("/reservations");
}

export async function cancelResourceReservation(formData: FormData) {
  const ctx = await requireOrganization();
  await assertPermission(ctx, "orders.manage");
  const parsed = z.object({
    id: z.string().uuid(),
    reason: z.string().trim().min(3).max(1000),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error("Motif d'annulation invalide.");
  const { error } = await ctx.supabase.rpc("cancel_resource_reservation", {
    p_org: ctx.organizationId,
    p_reservation: parsed.data.id,
    p_reason: parsed.data.reason,
  });
  if (error) throw new Error("Annulation impossible : " + error.message);
  revalidatePath("/reservations");
}

export async function updateResourceReservationPeriod(formData: FormData) {
  const ctx = await requireOrganization();
  await assertPermission(ctx, "orders.manage");
  const raw = Object.fromEntries(formData);
  const parsed = z.object({
    id: z.string().uuid(),
    timezone_name: timezone,
  }).safeParse(raw);
  if (!parsed.success) throw new Error("Informations de modification invalides.");
  const start = parseDateWithOffset(raw.start_at, "Début");
  const end = parseDateWithOffset(raw.end_at, "Fin");
  if (new Date(end) <= new Date(start)) throw new Error("La fin doit être postérieure au début.");
  const { error } = await ctx.supabase.rpc("update_resource_reservation_period", {
    p_org: ctx.organizationId,
    p_reservation: parsed.data.id,
    p_start_at: start,
    p_end_at: end,
    p_timezone: parsed.data.timezone_name,
  });
  if (error) throw new Error("Modification impossible : " + error.message);
  revalidatePath("/reservations");
}
