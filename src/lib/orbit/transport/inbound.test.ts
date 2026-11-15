import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseMagniboxInboundPayload, verifyMagniboxInboundSignature } from "./inbound";
const secret="magnibox-test-secret-with-at-least-thirty-two-characters";
const body=JSON.stringify({messageId:"queue-123",from:"Sender <sender@example.net>",to:["finance@entreprise.mg"],subject:"Bonjour",text:"Message entrant"});
const ts="1794700000";
const sig="sha256="+createHmac("sha256",secret).update(ts+"."+body).digest("hex");
describe("Magnibox native inbound gateway",()=>{
 it("validates signed, fresh requests only",()=>{
  expect(verifyMagniboxInboundSignature(body,ts,sig,secret,1794700000000)).toBe(true);
  expect(verifyMagniboxInboundSignature(body,ts,sig,secret,1794700400000)).toBe(false);
  expect(verifyMagniboxInboundSignature(body,ts,sig,"short",1794700000000)).toBe(false);
  expect(verifyMagniboxInboundSignature(body,ts,"sha256="+"0".repeat(64),secret,1794700000000)).toBe(false);
 });
 it("normalizes sender and recipients and rejects malformed payloads",()=>{
  expect(parseMagniboxInboundPayload(JSON.parse(body))).toMatchObject({from:"sender@example.net",to:["finance@entreprise.mg"]});
  expect(()=>parseMagniboxInboundPayload({...JSON.parse(body),to:["finance@entreprise.mg","FINANCE@entreprise.mg"]})).toThrow();
  expect(()=>parseMagniboxInboundPayload({...JSON.parse(body),text:"x".repeat(100001)})).toThrow();
 });
});
