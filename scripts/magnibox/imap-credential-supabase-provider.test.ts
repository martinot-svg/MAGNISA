import { describe, expect, it } from "vitest";
import { createMagniboxSupabaseCredentialProvider, type MagniboxCredentialVaultRpcClient } from "./imap-credential-supabase-provider";
import type { MagniboxCredentialKeyring } from "./imap-credential-crypto";
import { MagniboxCredentialError } from "./imap-credential-provider";

const scope={organizationId:"org-test",mailboxId:"mailbox-test"};
const credentials={host:"imap.internal",port:993,secure:true,username:"pilot",password:"synthetic-test-secret"};
const keyring:MagniboxCredentialKeyring={activeKeyId:"k1",keys:{k1:Buffer.alloc(32,9)}};
function fakeClient(handler:(name:string,args:Record<string,unknown>)=>unknown):MagniboxCredentialVaultRpcClient {
  return {rpc:async(name,args)=>({data:handler(name,args),error:null})};
}

describe("MAGNIBOX Supabase credential provider",()=>{
  it("encrypts before calling the service-only store RPC",async()=>{
    let received:Record<string,unknown>|undefined;
    const provider=createMagniboxSupabaseCredentialProvider(fakeClient((name,args)=>{
      expect(name).toBe("magnibox_store_imap_credential"); received=args;
      return [{credential_id:"cred-1",credential_version:1,credential_status:"active"}];
    }),keyring);
    const result=await provider.rotate({...scope,credentials,idempotencyKey:"request-1"});
    expect(result).toMatchObject({credentialId:"cred-1",version:1,status:"active"});
    expect(received?.p_ciphertext).not.toContain(credentials.password);
    expect(received?.p_organization_id).toBe(scope.organizationId);
    expect(received?.p_mailbox_id).toBe(scope.mailboxId);
  });
  it("decrypts only an active row matching the exact tenant and mailbox",async()=>{
    const encryptedProvider=createMagniboxSupabaseCredentialProvider(fakeClient(()=>[]),keyring);
    const envelope=await encryptedProvider.rotate({...scope,credentials,idempotencyKey:"request-2"});
    expect(envelope.status).toBe("active");
    const {encryptMagniboxImapCredentials}=await import("./imap-credential-crypto");
    const encrypted=encryptMagniboxImapCredentials(credentials,scope,keyring);
    const provider=createMagniboxSupabaseCredentialProvider(fakeClient(()=>[{
      credential_id:"cred-2",organization_id:scope.organizationId,mailbox_id:scope.mailboxId,
      credential_version:1,envelope_version:1,algorithm:"aes-256-gcm",key_id:encrypted.keyId,
      nonce:encrypted.nonce,ciphertext:encrypted.ciphertext,auth_tag:encrypted.tag,status:"active"
    }]),keyring);
    await expect(provider.getActive(scope)).resolves.toEqual(credentials);
    await expect(provider.getActive({...scope,mailboxId:"other-box"})).rejects.toBeInstanceOf(MagniboxCredentialError);
  });
  it("rejects missing or mismatched active credentials and validates revocation",async()=>{
    const missing=createMagniboxSupabaseCredentialProvider(fakeClient(()=>[]),keyring);
    await expect(missing.getActive(scope)).rejects.toBeInstanceOf(MagniboxCredentialError);
    const provider=createMagniboxSupabaseCredentialProvider(fakeClient((name)=>name==="magnibox_revoke_active_imap_credential"?true:[]),keyring);
    await expect(provider.revoke(scope)).resolves.toBeUndefined();
  });
  it("does not leak database error details",async()=>{
    const client:MagniboxCredentialVaultRpcClient={rpc:async()=>({data:null,error:{message:"database detail synthetic-test-secret"}})};
    const provider=createMagniboxSupabaseCredentialProvider(client,keyring);
    await expect(provider.getActive(scope)).rejects.toThrow("Credential vault operation failed");
    await expect(provider.getActive(scope)).rejects.not.toThrow("synthetic-test-secret");
  });
});
