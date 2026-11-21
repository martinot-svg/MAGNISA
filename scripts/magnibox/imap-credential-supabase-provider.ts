import {
  MagniboxCredentialError,
  validateMagniboxCredentialScope,
  type MagniboxImapCredentialProvider,
  type MagniboxImapCredentialScope,
  type MagniboxImapCredentialMetadata,
  type MagniboxImapConnectionCredentials,
} from "./imap-credential-provider";
import {
  decryptMagniboxImapCredentials,
  encryptMagniboxImapCredentials,
  type MagniboxCredentialKeyring,
  type MagniboxEncryptedCredentialEnvelope,
} from "./imap-credential-crypto";

type RpcResult = { data: unknown; error: { message?: string } | null };
export interface MagniboxCredentialVaultRpcClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult>;
}
type CredentialRow = Record<string, unknown>;

function record(value: unknown): CredentialRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MagniboxCredentialError("Invalid credential vault response");
  return value as CredentialRow;
}
function textField(row: CredentialRow, field: string): string {
  const value = row[field];
  if (typeof value !== "string" || !value) throw new MagniboxCredentialError("Invalid credential vault response");
  return value;
}
function numberField(row: CredentialRow, field: string): number {
  const value = row[field];
  if (!Number.isInteger(value) || (value as number) < 1) throw new MagniboxCredentialError("Invalid credential vault response");
  return value as number;
}
function envelopeFrom(row: CredentialRow): MagniboxEncryptedCredentialEnvelope {
  if (row.envelope_version !== 1 || row.algorithm !== "aes-256-gcm") throw new MagniboxCredentialError("Unsupported credential vault envelope");
  return { version: 1, algorithm: "aes-256-gcm", keyId: textField(row,"key_id"), nonce: textField(row,"nonce"), ciphertext: textField(row,"ciphertext"), tag: textField(row,"auth_tag") };
}
async function rpc(client: MagniboxCredentialVaultRpcClient, name: string, args: Record<string, unknown>): Promise<unknown> {
  const result = await client.rpc(name,args);
  if (result.error) throw new MagniboxCredentialError("Credential vault operation failed");
  return result.data;
}

/** Must be constructed only with a server-side Supabase service-role client. */
export function createMagniboxSupabaseCredentialProvider(
  client: MagniboxCredentialVaultRpcClient,
  keyring: MagniboxCredentialKeyring,
): MagniboxImapCredentialProvider {
  return {
    async getActive(scope: MagniboxImapCredentialScope): Promise<MagniboxImapConnectionCredentials> {
      validateMagniboxCredentialScope(scope);
      const data = await rpc(client,"magnibox_get_active_imap_credential",{p_organization_id:scope.organizationId,p_mailbox_id:scope.mailboxId});
      if (!Array.isArray(data) || data.length !== 1) throw new MagniboxCredentialError("No active IMAP credentials for this mailbox");
      const row = record(data[0]);
      if (textField(row,"organization_id") !== scope.organizationId || textField(row,"mailbox_id") !== scope.mailboxId || row.status !== "active") {
        throw new MagniboxCredentialError("Credential scope mismatch");
      }
      return decryptMagniboxImapCredentials(envelopeFrom(row),scope,keyring);
    },
    async rotate(input): Promise<MagniboxImapCredentialMetadata> {
      validateMagniboxCredentialScope(input);
      if (typeof input.idempotencyKey !== "string" || input.idempotencyKey.trim().length < 1 || input.idempotencyKey.length > 200) {
        throw new MagniboxCredentialError("Invalid credential rotation idempotency key");
      }
      const envelope = encryptMagniboxImapCredentials(input.credentials,input,keyring);
      const data = await rpc(client,"magnibox_store_imap_credential",{
        p_organization_id:input.organizationId,p_mailbox_id:input.mailboxId,
        p_envelope_version:envelope.version,p_algorithm:envelope.algorithm,
        p_key_id:envelope.keyId,p_nonce:envelope.nonce,p_ciphertext:envelope.ciphertext,
        p_auth_tag:envelope.tag,p_idempotency_key:input.idempotencyKey,
      });
      if (!Array.isArray(data) || data.length !== 1) throw new MagniboxCredentialError("Credential vault returned an invalid rotation result");
      const row = record(data[0]);
      const status = textField(row,"credential_status");
      if (status !== "active" && status !== "revoked") throw new MagniboxCredentialError("Credential vault returned an invalid status");
      return {credentialId:textField(row,"credential_id"),organizationId:input.organizationId,mailboxId:input.mailboxId,version:numberField(row,"credential_version"),status};
    },
    async revoke(scope): Promise<void> {
      validateMagniboxCredentialScope(scope);
      const data = await rpc(client,"magnibox_revoke_active_imap_credential",{p_organization_id:scope.organizationId,p_mailbox_id:scope.mailboxId});
      if (typeof data !== "boolean") throw new MagniboxCredentialError("Credential vault returned an invalid revocation result");
    },
  };
}

// Keep the RPC payload shape explicit at compile time for future changes.
export type MagniboxCredentialVaultEnvelopeInput = MagniboxEncryptedCredentialEnvelope;
