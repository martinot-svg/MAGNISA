import { describe, expect, it } from "vitest";
import { detectMagniboxAttachmentMime } from "./attachment-scan-core";

describe("detectMagniboxAttachmentMime", () => {
  it("recognizes supported file signatures", () => {
    expect(detectMagniboxAttachmentMime(Buffer.from("%PDF-1.7"))).toBe("application/pdf");
    expect(detectMagniboxAttachmentMime(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe("image/png");
    expect(detectMagniboxAttachmentMime(Buffer.from([0xff, 0xd8, 0xff, 0x00]))).toBe("image/jpeg");
    expect(detectMagniboxAttachmentMime(Buffer.from("GIF89a"))).toBe("image/gif");
    expect(detectMagniboxAttachmentMime(Buffer.from("RIFF0000WEBP"))).toBe("image/webp");
  });

  it("accepts valid UTF-8 text and rejects binary or empty content", () => {
    expect(detectMagniboxAttachmentMime(Buffer.from("Bonjour MAGNIBOX"))).toBe("text/plain");
    expect(detectMagniboxAttachmentMime(Buffer.from([0x41, 0x00, 0x42]))).toBeNull();
    expect(detectMagniboxAttachmentMime(Buffer.alloc(0))).toBeNull();
    expect(detectMagniboxAttachmentMime(Buffer.from([0xff, 0xfe, 0xfd]))).toBeNull();
  });

  it("does not trust extensions or declared MIME types", () => {
    expect(detectMagniboxAttachmentMime(Buffer.from("<html>fake pdf</html>"))).toBe("text/plain");
    expect(detectMagniboxAttachmentMime(Buffer.from("PK\\x03\\x04"))).toBe("text/plain");
  });
});


describe("ClamAV INSTREAM protocol", () => {
  it("frames payloads with a NUL command and network-order chunk lengths", async () => {
    const { buildClamAvInstreamFrames } = await import("./attachment-scan-core");
    const frames = buildClamAvInstreamFrames(Buffer.from("abcdef"), 3);
    expect(frames[0]).toEqual(Buffer.from("zINSTREAM\0", "ascii"));
    expect(frames[1].readUInt32BE(0)).toBe(3);
    expect(frames[2].toString()).toBe("abc");
    expect(frames[3].readUInt32BE(0)).toBe(3);
    expect(frames[4].toString()).toBe("def");
    expect(frames[5]).toEqual(Buffer.alloc(4));
  });

  it("parses only complete NUL-terminated scanner replies", async () => {
    const { parseClamAvInstreamResponse } = await import("./attachment-scan-core");
    expect(parseClamAvInstreamResponse(Buffer.from("stream: O"))).toBeNull();
    expect(parseClamAvInstreamResponse(Buffer.from("stream: OK\0"))).toBe("clean");
    expect(parseClamAvInstreamResponse(Buffer.from("stream: Eicar FOUND\0"))).toBe("infected");
    expect(parseClamAvInstreamResponse(Buffer.from("stream: ERROR\0"))).toBe("error");
    expect(parseClamAvInstreamResponse(Buffer.from("INSTREAM size limit exceeded. ERROR\0"))).toBe("error");
  });
});
