import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  MAGNIBOX_INBOUND_MAX_TEXT_CHARS,
  parseMagniboxInboundPayload,
  verifyMagniboxInboundSignature,
} from "./inbound";
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
  expect(()=>parseMagniboxInboundPayload({...JSON.parse(body),text:"x".repeat(MAGNIBOX_INBOUND_MAX_TEXT_CHARS+1)})).toThrow();
 });
 it("accepts a body exactly at the database limit",()=>{
  expect(parseMagniboxInboundPayload({...JSON.parse(body),text:"x".repeat(MAGNIBOX_INBOUND_MAX_TEXT_CHARS)}).text).toHaveLength(50000);
 });

 it("validates bounded base64 attachments without trusting their declared MIME",()=>{
  const attachment={fileName:"invoice.pdf",contentType:"application/pdf",contentBase64:Buffer.from("%PDF-1.7").toString("base64")};
  expect(parseMagniboxInboundPayload({...JSON.parse(body),attachments:[attachment]}).attachments).toHaveLength(1);
  expect(()=>parseMagniboxInboundPayload({...JSON.parse(body),attachments:[{...attachment,contentBase64:"%%%"}]})).toThrow();
  expect(()=>parseMagniboxInboundPayload({...JSON.parse(body),attachments:Array(6).fill(attachment)})).toThrow();
  expect(()=>parseMagniboxInboundPayload({...JSON.parse(body),attachments:[{...attachment,fileName:"../secret.pdf"}]}).attachments[0].fileName).not.toContain("/");
 });

});
