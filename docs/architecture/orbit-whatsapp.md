# MAGNISA ORBIT — WhatsApp Business architecture

**Status:** Architecture approved for implementation  
**Branch:** `feat/orbit-whatsapp-company`  
**Account model:** `company` — each MAGNISA organization connects its own WhatsApp Business Account (WABA) and business phone number.  
**Product boundary:** WhatsApp is an ORBIT module. MAGNIBOX remains the separate email product.

## 1. Product behavior

MAGNISA provides a first-party chat and inbox experience inside `/orbit/whatsapp`. It is not an embedded WhatsApp Web session and does not expose a personal WhatsApp account.

The full module includes:
- Organization-level WhatsApp Business connection and connection health.
- Conversation list, search, unread state, contact details and message timeline.
- Inbound text and supported media/document messages.
- Outbound text, approved templates and supported media/document messages.
- Delivery lifecycle: accepted, sent, delivered, read, failed.
- Invoice and quote PDF dispatch from their MAGNISA detail pages.
- Auditable history and organization-scoped access controls.

## 2. Existing application integration points

Repository inspection (2026-11-16):
- Next.js 15.5 / React 19 / TypeScript; Supabase SSR and Supabase JS.
- ORBIT hub: `src/app/(app)/orbit/page.tsx`; currently links Magnibox, Planner, Time and Action.
- Invoice list: `src/app/(app)/factures/page.tsx`, organization-scoped with `requireOrganization()` and `billing.view`.
- Invoice tracker: `src/components/invoice-tracker.tsx`; rows link to invoice detail.
- Existing PDF email route: `src/app/api/documents/[type]/[id]/email/route.ts`; it renders PDFs with `renderPdf()`, checks document permissions and sends through the existing Gmail connection.
- Middleware currently protects app pages by prefix; ORBIT paths must use the same server-side organization/auth guards in their pages and API routes.

Reuse the document rendering logic, not Gmail transport or mail-history semantics, for WhatsApp.

## 3. High-level architecture

```text
Browser — /orbit/whatsapp
  | authenticated Next.js pages/actions
  v
MAGNISA server layer
  | requireOrganization + permission checks
  | tenant-scoped repositories
  | WhatsApp application services
  | PDF renderer for invoice/quote attachments
  v
Meta WhatsApp Business Cloud API
  ^                         |
  | signed webhook          | Graph API
  |                         v
Webhook route -> verify signature -> normalize -> deduplicate -> persist
                                      -> update conversation/message state
                                      -> notify UI / refresh inbox
```

No browser-to-Meta API calls. Access tokens and app secrets stay server-side. Do not add a BSP dependency; integrate directly with Meta Cloud API.

## 4. Proposed routes

### UI
- `/orbit/whatsapp` — inbox and connection status.
- `/orbit/whatsapp/conversations/[id]` — conversation detail.
- `/orbit/whatsapp/settings` — connect/manage the organization's WABA and phone number.

### Server API
- `POST /api/orbit/whatsapp/connect` — persist verified connection metadata after OAuth/Embedded Signup exchange.
- `DELETE /api/orbit/whatsapp/connect` — disconnect/revoke local integration.
- `POST /api/orbit/whatsapp/messages` — validate tenant, recipient, consent/window/template, then send.
- `GET /api/orbit/whatsapp/conversations` — tenant-scoped inbox data.
- `GET /api/orbit/whatsapp/conversations/[id]/messages` — tenant-scoped timeline.
- `GET /api/webhooks/whatsapp` — Meta webhook challenge verification.
- `POST /api/webhooks/whatsapp` — verify X-Hub-Signature-256, parse and persist webhook events idempotently.
- `POST /api/documents/[type]/[id]/whatsapp` — permission-checked invoice/quote PDF send through the WhatsApp service.

The webhook is the only unauthenticated public endpoint; it must validate Meta's challenge/signature and must never trust organization IDs supplied in webhook payloads.

## 5. Data model (Supabase)

All business records include `organization_id`, same-tenant composite foreign keys where relevant, and RLS policies. The first foundation migration is `supabase/migrations/20261116190000_orbit_whatsapp_company_foundation.sql`; the implemented table prefix is `orbit_whatsapp_*`.

### `orbit_whatsapp_connections`
- `id`, `organization_id` (unique per active phone/account as product policy decides)
- `waba_id`, `phone_number_id`, `display_phone_number`, `verified_name`
- encrypted access-token material / secret reference, token expiry, scopes
- `status` (pending, active, expired, disconnected, error), timestamps, created_by

### `orbit_whatsapp_contacts`
- `id`, `organization_id`, `wa_id`, `display_name`, `phone_e164`, `customer_id` nullable
- `opt_in_status`, `opt_in_source`, `opt_in_at`, `opt_out_at`
- unique `(organization_id, wa_id)`

### `orbit_whatsapp_conversations`
- `id`, `organization_id`, `connection_id`, `contact_id`
- `last_message_at`, `last_message_preview`, `unread_count`, `status`
- unique active conversation policy per connection/contact

### `orbit_whatsapp_messages`
- `id`, `organization_id`, `conversation_id`, `contact_id`, `connection_id`
- `direction`, `message_type`, `text_body`, `media_storage_path`, `mime_type`, `file_name`
- `meta_message_id` unique when present, `status`, `error_code`, `error_detail`
- `template_name`, `context_message_id`, `sent_at`, `delivered_at`, `read_at`, `created_by`

### `orbit_whatsapp_message_events`
- `id`, `organization_id`, `message_id`, `provider_event_id` / dedupe key, `event_type`, `payload_redacted`, `occurred_at`
- unique deduplication key; retain only necessary and redacted provider payload data.

### `orbit_whatsapp_document_dispatches`
- `id`, `organization_id`, `message_id`, `document_type`, `document_id`, `recipient_contact_id`, `file_name`, `status`, `created_by`
- supports traceability from an invoice/quote to the WhatsApp message that delivered it.

Indexes should cover organization + last activity, conversation + created_at, and provider message IDs. RLS must enforce tenant isolation on every table and storage object. The service-role key must never be exposed to the client.

## 6. Security and compliance requirements

- Resolve the organization from the authenticated MAGNISA session, never from a client-supplied organization ID.
- Apply explicit permissions for inbox viewing, message sending, connection management and document export. Reuse the repository's permission conventions; add permission keys/migrations only after inspecting the permission catalog.
- Store Meta tokens encrypted at rest using a server-only encryption key or a managed secret store. Never log tokens, full webhook payloads, message bodies or private document URLs.
- Verify webhook HMAC SHA-256 against the raw request body before parsing. Use constant-time comparison.
- Enforce idempotency for webhook retries and outbound send retries; never duplicate invoice dispatches on a retried request.
- Validate E.164 recipients, file size/type, supported media, document ownership and customer relationship.
- Require documented recipient opt-in. Respect opt-out immediately.
- Enforce Meta's customer-service window and approved-template rules for business-initiated messages. Do not bypass template approval or consent requirements.
- Use private storage for media and short-lived signed URLs only where needed.
- Add rate limits, bounded retries with backoff, dead-letter/error visibility and audit events.
- Provide disconnect and credential rotation paths; do not silently fall back to another company's number.

## 7. Meta onboarding model

For this company-account SaaS model, each organization connects its own WABA and phone number. Use **WhatsApp Embedded Signup v4** through Facebook Login for Business; v2/v3 were deprecated on October 15, 2026. Create a v4 configuration in Meta App Dashboard and select Cloud API. The Cloud API product requires Advanced Access for `whatsapp_business_management` and `whatsapp_business_messaging`. MAGNISA must complete Meta's Tech Provider onboarding/App Review process before general customer onboarding; use a development/test WABA and test phone number first. The Graph API version must be configurable; the current Meta reference is v27.0 as of this architecture date.

The user-facing connection wizard must explain that the company controls its own WhatsApp Business account and number. MAGNISA stores only the authorization needed to operate that connected account.

## 8. Invoice workflow

1. User opens an invoice detail page and chooses **Envoyer par WhatsApp**.
2. Server checks `billing.view` and the existing `documents.export` action for invoices.
3. User confirms the customer's WhatsApp number and message.
4. Server loads the invoice by both invoice ID and organization ID, then renders its PDF with the existing `renderPdf()` pipeline.
5. The PDF is uploaded or made available to Meta's document-send endpoint using the supported Cloud API media flow.
6. Persist the provider message ID and link it to the invoice in `whatsapp_document_dispatches`.
7. Webhook status updates are reflected in the invoice send history and conversation timeline.

Email remains on its current Gmail route. WhatsApp gets its own transport and history; do not overload `recordMailHistory()`.

## 9. Implementation sequence and acceptance gates

### Phase 0 — foundation
- Confirm existing migrations, RLS patterns, permission catalog and storage conventions.
- Add architecture docs and tracked implementation issue.
- Create feature branch and CI scope.

### Phase 1 — secure persistence
- SQL migration, indexes, RLS, storage policies and permission keys.
- Unit/integration tests proving cross-organization reads/writes are denied.

### Phase 2 — Meta connection and webhook
- Server-only Graph API client, token encryption, connection wizard.
- Webhook challenge/signature verification, event normalization and deduplication tests.

### Phase 3 — messaging engine
- Outbound text/template/document; inbound text/media; status events.
- Retry/idempotency, consent and 24-hour/template policy tests.

### Phase 4 — ORBIT inbox UI
- Add WhatsApp card to ORBIT hub, inbox, conversation timeline, settings and error states.
- Add loading/empty/disconnected states and accessibility checks.

### Phase 5 — MAGNISA documents
- Add WhatsApp send action to invoice/quote detail surfaces.
- Verify PDF ownership, recipient confirmation, dispatch audit and status tracking.

### Phase 6 — hardening and release
- CI, lint, tests, migration dry-run, webhook replay tests, security review and staging test with Meta test assets.
- Production release only after Meta onboarding and credentials are supplied by the organization.

## 10. Required configuration (server only)

Server-only configuration (never commit real values):
- `META_APP_ID`
- `META_APP_SECRET`
- `META_CONFIG_ID` (Embedded Signup v4 Facebook Login for Business configuration)
- `NEXT_PUBLIC_META_APP_ID` (public app ID only; no secret)
- `WHATSAPP_GRAPH_API_VERSION` (e.g. `v27.0`, configurable)
- `WHATSAPP_TOKEN_ENCRYPTION_KEY`
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
- `WHATSAPP_GRAPH_API_VERSION`

Never commit real values. Add only documented placeholders to example env files.

## 11. Initial non-goals

- Embedding WhatsApp Web or personal WhatsApp sessions.
- Using an external BSP such as Twilio as a required dependency.
- Replacing MAGNIBOX or changing its SMTP/MTA roadmap.
- Sending messages without opt-in or bypassing Meta's approved-template rules.
- Claiming production-ready messaging before Meta credentials, webhook reachability and end-to-end delivery are verified.
