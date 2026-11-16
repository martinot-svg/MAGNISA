import { connect } from "node:net";
import { buildClamAvInstreamFrames, parseClamAvInstreamResponse } from "../magnibox/attachment-scan-core";

function scan(bytes: Buffer): Promise<"clean" | "infected"> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port: 3310 });
    const chunks: Buffer[] = [];
    let responseBytes = 0;
    let settled = false;
    const finish = (error?: Error, verdict?: "clean" | "infected") => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve(verdict!);
    };

    socket.setTimeout(30_000, () => finish(new Error("ClamAV integration scan timed out")));
    socket.on("error", error => finish(error));
    socket.on("end", () => finish(new Error("ClamAV closed before returning a verdict")));
    socket.on("data", chunk => {
      responseBytes += chunk.length;
      if (responseBytes > 8192) {
        finish(new Error("ClamAV response exceeded 8 KiB"));
        return;
      }
      chunks.push(chunk);
      const verdict = parseClamAvInstreamResponse(Buffer.concat(chunks));
      if (verdict === "clean" || verdict === "infected") finish(undefined, verdict);
      else if (verdict === "error") finish(new Error("ClamAV returned a scanner error"));
    });
    socket.on("connect", () => {
      for (const frame of buildClamAvInstreamFrames(bytes)) socket.write(frame);
    });
  });
}

async function main() {
  const clean = await scan(Buffer.from("MAGNIBOX ClamAV integration test: harmless text.\n"));
  if (clean !== "clean") throw new Error(`Expected clean verdict, received ${clean}`);

  // EICAR is a harmless industry-standard antivirus test pattern, not malware.
  const eicar = Buffer.from("X5O!P%@AP[4\\\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*");
  const infected = await scan(eicar);
  if (infected !== "infected") throw new Error(`Expected EICAR test detection, received ${infected}`);

  process.stdout.write("MAGNIBOX live ClamAV INSTREAM integration passed: clean and EICAR test verdicts confirmed.\\n");
}

main().catch(error => {
  process.stderr.write(`MAGNIBOX live ClamAV integration failed: ${error instanceof Error ? error.message : "unknown error"}\\n`);
  process.exitCode = 1;
});
