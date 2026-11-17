export function assertMagniboxPostfixTransport(mainConfig, masterConfig) {
  const settings = new Map();
  for (const line of mainConfig.split(/\r?\n/)) {
    const match = line.match(/^\s*([a-z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (match) settings.set(match[1], match[2]);
  }
  const required = [
    ["virtual_mailbox_domains", "hash:/tmp/docker-mailserver/magnibox-test-domains"],
    ["virtual_mailbox_maps", "hash:/tmp/docker-mailserver/magnibox-test-recipients"],
    ["virtual_transport", "magnibox-inbound"],
  ];
  for (const [key, value] of required) {
    if (settings.get(key) !== value) {
      throw new Error("Postfix active main.cf is missing " + key + " = " + value);
    }
  }
  const bridgeVariables = ["MAGNIBOX_INBOUND_URL", "MAGNIBOX_INBOUND_WEBHOOK_SECRET", "MAGNIBOX_INBOUND_ALLOW_HTTP_LOCAL"];
  const importedEnvironment = new Set((settings.get("import_environment") || "").split(/\s+/));
  const exportedEnvironment = new Set((settings.get("export_environment") || "").split(/\s+/));
  for (const name of bridgeVariables) {
    if (!importedEnvironment.has(name)) {
      throw new Error("Postfix master does not import " + name + " from the container environment");
    }
    if (!exportedEnvironment.has(name)) {
      throw new Error("Postfix pipe transport does not export " + name + " to the bridge process");
    }
  }
  const lines = masterConfig.split(/\r?\n/);
  const serviceIndex = lines.findIndex(line => /^magnibox-inbound\s+unix\s+.*\bpipe\s*$/.test(line.trim()));
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
