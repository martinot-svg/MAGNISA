import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  MAGNIBOX_INBOUND_MAX_TEXT_CHARS,
  isMagniboxInboundContentLengthTooLarge,
  parseMagniboxInboundPayload,
  readMagniboxInboundBody,
  readMagniboxBoundedBody,
  MagniboxInboundBodyTooLargeError,
  verifyMagniboxInboundSignature,
} from "./inbound";
const secret="magnibox-test-secret-with-at-least-thirty-two-characters";
const body=JSON.stringify({messageId:"queue-123",from:"Sender <sender@example.net>",to:["finance@entreprise.mg"],subject:"Bonjour",text:"Message entrant"});
const ts="1794700000";
const sig="sha256="+createHmac("sha256",secret).update(ts+"."+body).digest("hex");
describe("Magnibox inbound Content-Length guard", () => {
  it("rejects only valid decimal lengths above the hard limit", () => {
    const limit = 28 * 1024 * 1024;
    expect(isMagniboxInboundContentLengthTooLarge(String(limit), limit)).toBe(false);
    expect(isMagniboxInboundContentLengthTooLarge(String(limit + 1), limit)).toBe(true);
    expect(isMagniboxInboundContentLengthTooLarge(null, limit)).toBe(false);
    expect(isMagniboxInboundContentLengthTooLarge("chunked", limit)).toBe(false);
    expect(isMagniboxInboundContentLengthTooLarge("12x", limit)).toBe(false);
  });
});

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


describe("Magnibox bounded inbound body reader", () => {
  it("reads a body within the byte limit and rejects invalid UTF-8", async () => {
    const body = new Response("signed-body").body;
    await expect(readMagniboxInboundBody(body, 11)).resolves.toBe("signed-body");
    const invalidUtf8 = new Response(new Uint8Array([0xc3, 0x28])).body;
    await expect(readMagniboxInboundBody(invalidUtf8, 10)).rejects.toThrow();
  });

  it("stops reading once the byte limit is exceeded", async () => {
    const body = new Response(new Uint8Array(9)).body;
    await expect(readMagniboxInboundBody(body, 8)).rejects.toBeInstanceOf(MagniboxInboundBodyTooLargeError);
  });

  it("shares the same strict byte ceiling with outbound requests", async () => {
    await expect(readMagniboxBoundedBody(new Response("12345678").body, 8)).resolves.toBe("12345678");
    await expect(readMagniboxBoundedBody(new Response("123456789").body, 8))
      .rejects.toBeInstanceOf(MagniboxInboundBodyTooLargeError);
    await expect(readMagniboxBoundedBody(null, 8)).rejects.toThrow("Missing request body.");
    await expect(readMagniboxBoundedBody(new Response("x").body, 0)).rejects.toThrow("Invalid body limit.");
  });
});
