import { MagniboxSmtpTransport } from "../../src/lib/orbit/transport/smtp";

async function main() {
const baseUrl = process.env.MAILPIT_API_URL ?? "http://127.0.0.1:8025";
const requestId = "28700000-0000-4000-8000-000000000001";
const subject = "MAGNIBOX local Postfix Mailpit E2E";
const transport = new MagniboxSmtpTransport();

const accepted = await transport.send({
  from: "sender@example.test",
  to: ["recipient@example.invalid"],
  subject,
  text: "Local-only SMTP acceptance test. No external recipient is contacted.",
  requestId,
});

if (accepted.provider !== "smtp" || accepted.state !== "accepted" || !accepted.providerMessageId) {
  throw new Error("MAGNIBOX SMTP transport did not return a valid Postfix queue acceptance.");
}

const deadline = Date.now() + 45_000;
let captured: unknown;
while (Date.now() < deadline) {
  const response = await fetch(`${baseUrl}/api/v1/messages?limit=50`);
  if (!response.ok) throw new Error(`Mailpit API returned HTTP ${response.status}`);
  const payload: unknown = await response.json();
  const serialized = JSON.stringify(payload);
  if (serialized.includes(subject) && serialized.includes("sender@example.test") && serialized.includes("recipient@example.invalid")) {
    captured = payload;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}

if (!captured) {
  throw new Error("Postfix accepted the message, but Mailpit did not capture the expected subject and request ID within 45 seconds.");
}

console.log(JSON.stringify({
  provider: accepted.provider,
  queueId: accepted.providerMessageId,
  capturedInMailpit: true,
  subject,
  requestId,
  externalDeliveryAttempted: false,
}, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
