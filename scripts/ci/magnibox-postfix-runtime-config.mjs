export function assertMagniboxPostfixTransport(mainConfig, masterConfig) {
  const required = [
    ["virtual_mailbox_domains", "hash:/tmp/docker-mailserver/magnibox-test-domains"],
    ["virtual_mailbox_maps", "hash:/tmp/docker-mailserver/magnibox-test-recipients"],
    ["virtual_transport", "magnibox-inbound"],
  ];
  for (const [key, value] of required) {
    const expression = new RegExp("^" + key + "\\s*=\\s*" + value.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&") + "\\s*$", "m");
    if (!expression.test(mainConfig)) {
      throw new Error("Postfix active main.cf is missing " + key + " = " + value);
    }
  }
  const lines = masterConfig.split(/\\r?\\n/);
  const serviceIndex = lines.findIndex(line => /^magnibox-inbound\\s+unix\\s+.*\\bpipe\\s*$/.test(line.trim()));
  if (serviceIndex < 0) {
    throw new Error("Postfix active master.cf has no magnibox-inbound pipe service");
  }
  const command = lines.slice(serviceIndex + 1, serviceIndex + 3).join(" ");
  if (!command.includes("/opt/magnibox-bridge/postfix-inbound.py")
    || !command.includes("${sender}") || !command.includes("${recipient}")) {
    throw new Error("Postfix magnibox-inbound service does not invoke the envelope bridge with sender and recipient");
  }
  return true;
}
