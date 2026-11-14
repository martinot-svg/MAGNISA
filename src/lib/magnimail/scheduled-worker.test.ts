import { describe, expect, it, vi } from "vitest";
import { runMGMailScheduledDispatch } from "./scheduled-worker";

type Admin = NonNullable<NonNullable<Parameters<typeof runMGMailScheduledDispatch>[0]>["admin"]>;

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const MAILBOX = "33333333-3333-4333-8333-333333333333";
const IDENTITY = "44444444-4444-4444-8444-444444444444";
const MESSAGE = "55555555-5555-4555-8555-555555555555";
const NOW = new Date("2026-11-14T05:00:00.000Z");

function fakeAdmin(options: { senderActive?: boolean; identityActive?: boolean } = {}) {
  const rows = [{
    id: MESSAGE, organization_id: ORG, identity_id: IDENTITY,
    direction: "outgoing", source_kind: "scheduled",
    status: "queued",
    scheduled_at: "2026-11-14T04:30:00.000Z",
    from_email: "finance@mitalia.digital",
    to_emails: ["client@gmail.com"],
    subject: "Rendez-vous facturation",
    body_text: "Bonjour, votre rendez-vous est confirmé.",
    created_by: USER,
    recurring_contract_id: null,
    preavis_billing_date: null,
    preavis_days_before: null,
    provider_email_id: null as string | null,
  }];
  const from = (table: string) => {
    let mode: "read" | "update" = "read";
    let updates: Record<string, unknown> = {};
    const predicates: Array<(r: Record<string, unknown>) => boolean> = [];
    const q = {
      select(_fields?: string) { return q; },
      eq(key: string, value: unknown) {
        predicates.push((row) => row[key] === value); return q;
      },
      lte(key: string, value: string) {
        predicates.push((row) => String(row[key]) <= value); return q;
      },
      not() { return q; },
      order() { return q; },
      update(values: Record<string, unknown>) {
        mode = "update"; updates = values; return q;
      },
      // Supabase PostgREST query builders execute through their thenable
      // interface when awaited without select()/maybeSingle().
      then(
        onFulfilled?: (value: { data: null; error: null }) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) {
        if (mode === "update" && table === "mgmail_external_messages") {
          const row = rows.find((item) => predicates.every((fn) =>
            fn(item as unknown as Record<string, unknown>)));
          if (row) Object.assign(row, updates);
        }
        return Promise.resolve({ data: null, error: null }).then(onFulfilled, onRejected);
      },
      async range() {
        if (table === "mgmail_preavis_delivery_configs")
          return { data: [], error: null };
        throw Error("Unexpected paginated table: " + table);
      },
      async limit(n: number) {
        if (table !== "mgmail_external_messages") throw Error("Unexpected list");
        return {
          data: rows.filter((r) => predicates.every((fn) =>
            fn(r as unknown as Record<string, unknown>))).slice(0, n),
          error: null,
        };
      },
      async maybeSingle() {
        let data: Record<string, unknown> | null = null;
        if (table === "mgmail_external_messages") {
          const row = rows.find((r) => predicates.every((fn) =>
            fn(r as unknown as Record<string, unknown>)));
          if (row) {
            if (mode === "update") Object.assign(row, updates);
            data = row as unknown as Record<string, unknown>;
          }
        } else if (mode === "read") {
          const allRecords: Record<string, Record<string, unknown>[]> = {
            mgmail_external_identities: [{
              id: IDENTITY, organization_id: ORG, mailbox_id: MAILBOX,
              status: options.identityActive === false ? "suspended" : "active",
              provider: "resend", email_address: "finance@mitalia.digital",
              receive_enabled: true,
            }],
            organization_members: options.senderActive === false ? [] : [{
              organization_id: ORG, user_id: USER, status: "active",
            }],
            mgmail_internal_mailboxes: [{
              id: MAILBOX, organization_id: ORG, owner_user_id: USER,
              is_active: true, can_send: true, can_external_send: true,
            }],
            mgmail_internal_mailbox_grants: [],
          };
          const records = allRecords[table] || [];
          data = records.find((row) => predicates.every((fn) => fn(row))) || null;
        }
        return { data, error: null };
      },
    };
    return q;
  };
  return { admin: { from } as unknown as Admin, rows };
}

describe("MGMail worker — pas de faux envois ni de doublons", () => {
  const env = {
    MGMAIL_AUTO_SEND_ENABLED: "true",
    MGMAIL_RESEND_API_KEY: "test_key",
  };

  it("n'interroge pas la base lorsque le moteur est désactivé", async () => {
    const transport = vi.fn<typeof fetch>();
    const result = await runMGMailScheduledDispatch({
      env: { MGMAIL_AUTO_SEND_ENABLED: "false", MGMAIL_RESEND_API_KEY: "test_key" },
      transport,
    });
    expect(result.enabled).toBe(false);
    expect(transport).not.toHaveBeenCalled();
  });

  it("envoie une seule fois et conserve la confirmation du fournisseur", async () => {
    const fake = fakeAdmin();
    const transport = vi.fn<typeof fetch>(async () =>
      Response.json({ id: "provider-test-123" }));
    const result = await runMGMailScheduledDispatch({
      admin: fake.admin, now: NOW, env, transport,
    });
    expect(result).toMatchObject({ accepted: 1, cancelled: 0, uncertain: 0 });
    expect(fake.rows[0].status).toBe("accepted");
    expect(fake.rows[0].provider_email_id).toBe("provider-test-123");

    const repeated = await runMGMailScheduledDispatch({
      admin: fake.admin, now: NOW, env, transport,
    });
    expect(repeated.accepted).toBe(0);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("annule avant expédition si le collaborateur est suspendu", async () => {
    const fake = fakeAdmin({ senderActive: false });
    const transport = vi.fn<typeof fetch>();
    const result = await runMGMailScheduledDispatch({
      admin: fake.admin, now: NOW, env, transport,
    });
    expect(result.cancelled).toBe(1);
    expect(fake.rows[0].status).toBe("cancelled");
    expect(transport).not.toHaveBeenCalled();
  });

  it("n'expédie pas depuis une adresse Internet suspendue", async () => {
    const fake = fakeAdmin({ identityActive: false });
    const transport = vi.fn<typeof fetch>();
    const result = await runMGMailScheduledDispatch({
      admin: fake.admin, now: NOW, env, transport,
    });
    expect(result.cancelled).toBe(1);
    expect(transport).not.toHaveBeenCalled();
  });

  it("traite le délai réseau comme incertain sans renvoyer le courrier", async () => {
    const fake = fakeAdmin();
    const transport = vi.fn<typeof fetch>(async () => {
      throw Error("Connection lost after provider acceptance");
    });
    const result = await runMGMailScheduledDispatch({
      admin: fake.admin, now: NOW, env, transport,
    });
    expect(result.uncertain).toBe(1);
    expect(fake.rows[0].status).toBe("uncertain");

    await runMGMailScheduledDispatch({ admin: fake.admin, now: NOW, env, transport });
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
