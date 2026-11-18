import { describe, expect, it } from "vitest";
import { allowPublicSend, eligibleApprovedInboundRecipient, eligiblePublicRecipient, enabledMagniboxInternetMail, normalizeOutgoingMessage, validExternalRequestId } from "./gates";
const org="19f9440d-776b-470e-ae73-f9277f5b74e8";
const key="aeeb4255-0860-45d8-9c92-72488919ee51";
const sender={id:key,organization_id:org,domain_request_id:key,address_request_id:key,email_address:"finance@entreprise.mg",provider:"smtp",status:"active",provider_verified_at:"2026-11-14T08:00:00Z",provider_domain_ref:"magnibox-domain-1"};
const flags={enabled:true,hasCredentials:true,domainVerified:true,addressApproved:true,mailboxActive:true,recipientAuthorized:true};
describe("Magnibox native Internet mail: fail-closed gates",()=>{
 it("requires verified domain, approved address, active mailbox, authorizations and native SMTP",()=>{
  expect(allowPublicSend(sender,org,flags)).toBe(true);
  for(const k of Object.keys(flags) as Array<keyof typeof flags>) expect(allowPublicSend(sender,org,{...flags,[k]:false})).toBe(false);
  expect(allowPublicSend({...sender,organization_id:key},org,flags)).toBe(false);
  expect(allowPublicSend({...sender,status:"pending"},org,flags)).toBe(false);
  expect(allowPublicSend({...sender,provider:"resend"},org,flags)).toBe(false);
  expect(allowPublicSend({...sender,provider_domain_ref:""},org,flags)).toBe(false);
 });
 it("keeps Internet mail disabled by default",()=>{
  expect(enabledMagniboxInternetMail({} as NodeJS.ProcessEnv)).toBe(false);
  expect(enabledMagniboxInternetMail({MAGNIBOX_EXTERNAL_MAIL_ENABLED:"false"} as NodeJS.ProcessEnv)).toBe(false);
  expect(enabledMagniboxInternetMail({MAGNIBOX_EXTERNAL_MAIL_ENABLED:"true"} as NodeJS.ProcessEnv)).toBe(true);
 });
 it("rejects forged identities, invalid IDs and unsafe recipients",()=>{
  const valid={identityId:key,requestId:org,to:"client@example.com",subject:"Facture",text:"Bonjour"};
  expect(normalizeOutgoingMessage(valid).to).toEqual(["client@example.com"]);
  expect(()=>normalizeOutgoingMessage({...valid,identityId:"forged"})).toThrow();
  expect(()=>normalizeOutgoingMessage({...valid,to:"client@example.com;client@example.com"})).toThrow();
  expect(()=>normalizeOutgoingMessage({...valid,to:"client@example.com\nBcc: thief@example.net"})).toThrow();
  expect(()=>normalizeOutgoingMessage({...valid,subject:""})).toThrow();
  expect(()=>normalizeOutgoingMessage({...valid,subject:"Hello\r\nBcc: attacker@example.net"})).toThrow();
  expect(validExternalRequestId(org)).toBe(true); expect(validExternalRequestId("not-uuid")).toBe(false);
 });
 it("accepts only the exact active SMTP identity for inbound mail",()=>{
  expect(eligiblePublicRecipient({...sender,receive_enabled:true},"FINANCE@entreprise.mg")).toBe(true);
  expect(eligiblePublicRecipient({...sender,receive_enabled:false},"finance@entreprise.mg")).toBe(false);
  expect(eligiblePublicRecipient({...sender,status:"suspended",receive_enabled:true},"finance@entreprise.mg")).toBe(false);
  expect(eligiblePublicRecipient({...sender,receive_enabled:true},"finance@another-company.mg")).toBe(false);
 });
 it("accepts inbound mail only when identity, approved address and verified domain all match",()=>{
  const approved={recipient:"FINANCE@entreprise.mg",identityEmail:"finance@entreprise.mg",
   approvedEmail:"finance@entreprise.mg",verifiedDomain:"entreprise.mg",
   mailboxActive:true,domainVerified:true,addressApproved:true};
  expect(eligibleApprovedInboundRecipient(approved)).toBe(true);
  expect(eligibleApprovedInboundRecipient({...approved,approvedEmail:"other@entreprise.mg"})).toBe(false);
  expect(eligibleApprovedInboundRecipient({...approved,identityEmail:"other@entreprise.mg"})).toBe(false);
  expect(eligibleApprovedInboundRecipient({...approved,verifiedDomain:"attacker.example"})).toBe(false);
  expect(eligibleApprovedInboundRecipient({...approved,mailboxActive:false})).toBe(false);
  expect(eligibleApprovedInboundRecipient({...approved,domainVerified:false})).toBe(false);
  expect(eligibleApprovedInboundRecipient({...approved,addressApproved:false})).toBe(false);
  expect(eligibleApprovedInboundRecipient({...approved,recipient:"finance@entreprise.mg.evil"})).toBe(false);
 });
});
