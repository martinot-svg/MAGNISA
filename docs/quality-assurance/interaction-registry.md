# MAGNISA interaction registry

CI generates `test-results/interaction-registry.json` from the TypeScript and JSX source tree.

Every source location starts as `NOT_TESTED`. Static discovery never marks a control as functional. The registry records source handlers and navigation targets where available, while database tables and permission requirements remain unresolved until the handler is traced.

A source location may render multiple controls at runtime when it is inside a loop or conditional branch. Those instances still require runtime scenarios during module acceptance.

Required runtime acceptance:
- Visibility under the correct role.
- Client and server validation.
- Server-side authorization and organization isolation.
- Successful execution and persisted business result.
- Error handling with preserved form data.
- Duplicate submission and idempotency.
- Updated list, detail and aggregate views.

The JSON is uploaded as a CI artifact, not committed as a stale snapshot.
