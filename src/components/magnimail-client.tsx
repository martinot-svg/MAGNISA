"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type Folder = "inbox" | "sent" | "drafts" | "trash" | "templates";
type MailSummary = {
  id: string;
  messageId: string;
  threadId: string;
  kind: "message" | "draft";
  subject: string;
  from: string;
  to: string;
  cc: string;
  date: string;
  snippet: string;
  labelIds: string[];
  unread: boolean;
  timestamp: number;
};
type MailDetail = {
  id: string;
  messageId: string;
  threadId: string;
  kind: "message" | "draft";
  subject: string;
  from: string;
  to: string;
  cc: string;
  bcc: string;
  date: string;
  timestamp: number;
  body: string;
  labelIds: string[];
  messageIdHeader: string;
  references: string;
  attachments: Array<{
    filename: string;
    mimeType: string;
    attachmentId: string;
    size: number;
  }>;
  customer?: { id: string; name: string; email: string } | null;
  connectedEmail: string;
};
type Template = {
  key: string;
  name: string;
  subject: string;
  body: string;
  isActive: boolean;
  customized: boolean;
};

const folderLabels: Array<{ key: Folder; label: string }> = [
  { key: "inbox", label: "Boîte de réception" },
  { key: "sent", label: "Envoyés" },
  { key: "drafts", label: "Brouillons" },
  { key: "trash", label: "Corbeille" },
  { key: "templates", label: "Modèles" },
];

function extractEmail(value: string) {
  const match = value.match(/<([^>]+)>/);
  return (match?.[1] || value).trim().replace(/^"|"$/g, "");
}

function formatDate(timestamp: number, fallback: string) {
  if (timestamp) {
    try {
      return new Intl.DateTimeFormat("fr-FR", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(timestamp));
    } catch {}
  }
  return fallback || "";
}

function formatBytes(size: number) {
  if (!size) return "";
  if (size < 1024) return `${size} o`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} Ko`;
  return `${(size / 1024 / 1024).toFixed(1)} Mo`;
}

const emptyCompose = {
  to: "",
  cc: "",
  bcc: "",
  subject: "",
  body: "",
  threadId: "",
  inReplyTo: "",
  references: "",
  draftId: "",
  customerId: "",
};

export function MagniMailClient({ connectedEmail }: { connectedEmail: string }) {
  const [folder, setFolder] = useState<Folder>("inbox");
  const [items, setItems] = useState<MailSummary[]>([]);
  const [selected, setSelected] = useState<MailSummary | null>(null);
  const [detail, setDetail] = useState<MailDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [compose, setCompose] = useState(emptyCompose);
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateManage, setTemplateManage] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [templateBusy, setTemplateBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const title = useMemo(
    () => folderLabels.find((entry) => entry.key === folder)?.label || "MagniMail",
    [folder],
  );

  const loadMailbox = async () => {
    if (folder === "templates") return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ folder });
      if (query) params.set("q", query);
      const response = await fetch(`/api/magnimail/messages?${params.toString()}`, {
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Impossible de charger les e-mails.");
      setItems(data.items || []);
      setSelected(null);
      setDetail(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible de charger les e-mails.");
    } finally {
      setLoading(false);
    }
  };

  const loadTemplates = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/magnimail/templates", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Impossible de charger les modèles.");
      setTemplates(data.items || []);
      setTemplateManage(!!data.canManage);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible de charger les modèles.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (folder === "templates") void loadTemplates();
    else void loadMailbox();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder, query]);

  const openMessage = async (item: MailSummary) => {
    setSelected(item);
    setDetail(null);
    setDetailLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/magnimail/messages/${encodeURIComponent(item.id)}?kind=${item.kind}`,
        { cache: "no-store" },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Impossible de charger le message.");
      setDetail(data);
      setItems((current) =>
        current.map((mail) => (mail.id === item.id ? { ...mail, unread: false } : mail)),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible de charger le message.");
    } finally {
      setDetailLoading(false);
    }
  };

  const startCompose = (partial?: Partial<typeof emptyCompose>) => {
    setCompose({ ...emptyCompose, ...(partial || {}) });
    setFiles([]);
    setFeedback("");
    setComposeOpen(true);
  };

  const reply = () => {
    if (!detail) return;
    const messageRef = detail.messageIdHeader || "";
    startCompose({
      to: extractEmail(detail.from),
      subject: /^re:/i.test(detail.subject) ? detail.subject : `Re: ${detail.subject}`,
      body: `\n\n--- Message précédent ---\n${detail.body}`,
      threadId: detail.threadId,
      inReplyTo: messageRef,
      references: [detail.references, messageRef].filter(Boolean).join(" "),
      customerId: detail.customer?.id || "",
    });
  };

  const forward = () => {
    if (!detail) return;
    startCompose({
      subject: /^fwd:/i.test(detail.subject) ? detail.subject : `Fwd: ${detail.subject}`,
      body: `\n\n--- Message transféré ---\nDe : ${detail.from}\nÀ : ${detail.to}\nObjet : ${detail.subject}\n\n${detail.body}`,
      customerId: detail.customer?.id || "",
    });
  };

  const editDraft = () => {
    if (!detail || detail.kind !== "draft") return;
    startCompose({
      to: detail.to ? extractEmail(detail.to) : "",
      cc: detail.cc ? extractEmail(detail.cc) : "",
      bcc: detail.bcc ? extractEmail(detail.bcc) : "",
      subject: detail.subject === "(Sans objet)" ? "" : detail.subject,
      body: detail.body,
      threadId: detail.threadId,
      draftId: detail.id,
      customerId: detail.customer?.id || "",
    });
  };

  const composeFormData = () => {
    const form = new FormData();
    Object.entries(compose).forEach(([key, value]) => {
      if (value) form.set(key, value);
    });
    files.forEach((file) => form.append("attachments", file, file.name));
    return form;
  };

  const send = async () => {
    setSending(true);
    setFeedback("");
    try {
      const response = await fetch("/api/magnimail/send", {
        method: "POST",
        body: composeFormData(),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Envoi impossible.");
      setFeedback("E-mail envoyé depuis MagniMail.");
      setTimeout(() => {
        setComposeOpen(false);
        setFeedback("");
        if (folder === "sent" || folder === "drafts") void loadMailbox();
      }, 700);
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : "Envoi impossible.");
    } finally {
      setSending(false);
    }
  };

  const saveDraft = async () => {
    setSending(true);
    setFeedback("");
    try {
      const response = await fetch("/api/magnimail/drafts", {
        method: "POST",
        body: composeFormData(),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Enregistrement impossible.");
      setCompose((current) => ({ ...current, draftId: data.draftId || current.draftId }));
      setFeedback("Brouillon enregistré.");
      if (folder === "drafts") void loadMailbox();
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setSending(false);
    }
  };

  const moveMessage = async (action: "trash" | "untrash") => {
    if (!detail || detail.kind !== "message") return;
    setDetailLoading(true);
    try {
      const response = await fetch(
        `/api/magnimail/messages/${encodeURIComponent(detail.messageId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Action impossible.");
      setSelected(null);
      setDetail(null);
      await loadMailbox();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action impossible.");
    } finally {
      setDetailLoading(false);
    }
  };

  const removeDraft = async () => {
    if (!detail || detail.kind !== "draft") return;
    setDetailLoading(true);
    try {
      const response = await fetch(
        `/api/magnimail/drafts/${encodeURIComponent(detail.id)}`,
        { method: "DELETE" },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Suppression impossible.");
      setSelected(null);
      setDetail(null);
      await loadMailbox();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Suppression impossible.");
    } finally {
      setDetailLoading(false);
    }
  };

  const useTemplate = (template: Template) => {
    startCompose({ subject: template.subject, body: template.body });
  };

  const saveTemplate = async (event: FormEvent) => {
    event.preventDefault();
    if (!editingTemplate) return;
    setTemplateBusy(true);
    try {
      const response = await fetch("/api/magnimail/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingTemplate),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Enregistrement impossible.");
      setEditingTemplate(null);
      await loadTemplates();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setTemplateBusy(false);
    }
  };

  return (
    <div>
      <div className="pageHead">
        <div>
          <p className="eyebrow">Communication</p>
          <h1>MagniMail</h1>
          <p>
            Messagerie professionnelle intégrée à MAGNISA · connecté avec <b>{connectedEmail}</b>
          </p>
        </div>
        <button className="button primary" onClick={() => startCompose()}>
          Nouveau message
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "190px minmax(300px, .9fr) minmax(360px, 1.35fr)",
          gap: 16,
          alignItems: "start",
        }}
      >
        <aside className="card" style={{ padding: 12, position: "sticky", top: 16 }}>
          <div style={{ display: "grid", gap: 6 }}>
            {folderLabels.map((entry) => (
              <button
                key={entry.key}
                className={folder === entry.key ? "button primary" : "button ghost"}
                style={{ justifyContent: "flex-start", width: "100%" }}
                onClick={() => {
                  setFolder(entry.key);
                  setQuery("");
                  setSearchInput("");
                }}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <div style={{ marginTop: 18, borderTop: "1px solid #e5e7eb", paddingTop: 14 }}>
            <a className="button ghost" href="/parametres" style={{ width: "100%" }}>
              Comptes e-mail
            </a>
          </div>
        </aside>

        <section className="card" style={{ padding: 0, overflow: "hidden", minHeight: 560 }}>
          <div style={{ padding: 14, borderBottom: "1px solid #e5e7eb" }}>
            <strong>{title}</strong>
            {folder !== "templates" && (
              <form
                style={{ display: "flex", gap: 8, marginTop: 10 }}
                onSubmit={(event) => {
                  event.preventDefault();
                  setQuery(searchInput.trim());
                }}
              >
                <input
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="Rechercher dans Gmail"
                  style={{ flex: 1 }}
                />
                <button className="button" type="submit">
                  Rechercher
                </button>
              </form>
            )}
          </div>

          {error && (
            <div style={{ padding: 14, color: "#991b1b", background: "#fef2f2" }}>{error}</div>
          )}
          {loading && <div style={{ padding: 18 }} className="muted">Chargement…</div>}

          {!loading && folder !== "templates" && (
            <div style={{ display: "grid" }}>
              {!items.length && <div className="muted" style={{ padding: 22 }}>Aucun message.</div>}
              {items.map((item) => (
                <button
                  key={`${item.kind}-${item.id}`}
                  type="button"
                  onClick={() => void openMessage(item)}
                  style={{
                    textAlign: "left",
                    border: 0,
                    borderBottom: "1px solid #eef1f5",
                    background: selected?.id === item.id ? "#f3f7ff" : "#fff",
                    padding: "14px 16px",
                    cursor: "pointer",
                    font: "inherit",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <strong style={{ fontWeight: item.unread ? 800 : 600 }}>
                      {folder === "sent" ? item.to || "Destinataire" : item.from || item.to || "Brouillon"}
                    </strong>
                    <small className="muted">{formatDate(item.timestamp, item.date)}</small>
                  </div>
                  <div style={{ fontWeight: item.unread ? 700 : 500, marginTop: 5 }}>
                    {item.subject}
                  </div>
                  <div
                    className="muted"
                    style={{ fontSize: 12, marginTop: 5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {item.snippet}
                  </div>
                </button>
              ))}
            </div>
          )}

          {!loading && folder === "templates" && (
            <div style={{ display: "grid" }}>
              {templates.map((template) => (
                <div key={template.key} style={{ padding: 15, borderBottom: "1px solid #eef1f5" }}>
                  <strong>{template.name}</strong>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    {template.subject || "Sans objet prédéfini"}
                  </div>
                  <div className="actions" style={{ marginTop: 10 }}>
                    <button className="button primary" onClick={() => useTemplate(template)}>
                      Utiliser
                    </button>
                    {templateManage && (
                      <button className="button" onClick={() => setEditingTemplate({ ...template })}>
                        Modifier
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card" style={{ minHeight: 560 }}>
          {!selected && folder !== "templates" && (
            <div style={{ padding: "70px 20px", textAlign: "center" }} className="muted">
              Sélectionne un message pour l'afficher ici.
            </div>
          )}
          {folder === "templates" && !editingTemplate && (
            <div>
              <h2>Modèles d'e-mails</h2>
              <p className="muted">
                Les modèles peuvent utiliser des variables comme <code>{"{{client}}"}</code> et <code>{"{{numero}}"}</code>.
              </p>
              {templateManage && (
                <button
                  className="button"
                  onClick={() =>
                    setEditingTemplate({
                      key: `custom_${Date.now()}`,
                      name: "Nouveau modèle",
                      subject: "",
                      body: "Bonjour {{client}},\n\n\n\nCordialement.",
                      isActive: true,
                      customized: true,
                    })
                  }
                >
                  Créer un modèle
                </button>
              )}
            </div>
          )}
          {folder === "templates" && editingTemplate && (
            <form className="form" onSubmit={saveTemplate}>
              <h2>Modifier le modèle</h2>
              <div className="field">
                <label>Nom</label>
                <input
                  value={editingTemplate.name}
                  onChange={(event) =>
                    setEditingTemplate({ ...editingTemplate, name: event.target.value })
                  }
                  required
                />
              </div>
              <div className="field">
                <label>Objet</label>
                <input
                  value={editingTemplate.subject}
                  onChange={(event) =>
                    setEditingTemplate({ ...editingTemplate, subject: event.target.value })
                  }
                />
              </div>
              <div className="field">
                <label>Message</label>
                <textarea
                  rows={13}
                  value={editingTemplate.body}
                  onChange={(event) =>
                    setEditingTemplate({ ...editingTemplate, body: event.target.value })
                  }
                  required
                />
              </div>
              <div className="actions">
                <button className="button primary" disabled={templateBusy}>
                  {templateBusy ? "Enregistrement…" : "Enregistrer"}
                </button>
                <button className="button" type="button" onClick={() => setEditingTemplate(null)}>
                  Annuler
                </button>
              </div>
            </form>
          )}
          {detailLoading && <div className="muted">Chargement du message…</div>}
          {detail && !detailLoading && (
            <div>
              <div style={{ borderBottom: "1px solid #e5e7eb", paddingBottom: 16 }}>
                <p className="eyebrow">{detail.kind === "draft" ? "Brouillon" : "Message"}</p>
                <h2 style={{ marginBottom: 8 }}>{detail.subject}</h2>
                <div style={{ fontSize: 13 }}><b>De :</b> {detail.from || "—"}</div>
                <div style={{ fontSize: 13, marginTop: 4 }}><b>À :</b> {detail.to || "—"}</div>
                {detail.cc && <div style={{ fontSize: 13, marginTop: 4 }}><b>Cc :</b> {detail.cc}</div>}
                {detail.customer && (
                  <div style={{ marginTop: 10 }}>
                    <a className="badge" href={`/clients/${detail.customer.id}`}>
                      Client : {detail.customer.name}
                    </a>
                  </div>
                )}
              </div>

              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontFamily: "inherit",
                  fontSize: 14,
                  lineHeight: 1.6,
                  margin: "18px 0",
                }}
              >
                {detail.body || detail.snippet || "(Message vide)"}
              </pre>

              {!!detail.attachments.length && (
                <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 14 }}>
                  <strong>Pièces jointes</strong>
                  <div className="actions" style={{ marginTop: 10 }}>
                    {detail.attachments.map((attachment) => (
                      <a
                        key={attachment.attachmentId}
                        className="button"
                        href={`/api/magnimail/attachments/${encodeURIComponent(detail.messageId)}/${encodeURIComponent(attachment.attachmentId)}?filename=${encodeURIComponent(attachment.filename)}&mimeType=${encodeURIComponent(attachment.mimeType)}`}
                      >
                        {attachment.filename} {formatBytes(attachment.size)}
                      </a>
                    ))}
                  </div>
                </div>
              )}

              <div className="actions" style={{ marginTop: 20 }}>
                {detail.kind === "draft" ? (
                  <>
                    <button className="button primary" onClick={editDraft}>Modifier</button>
                    <button className="button" onClick={() => void removeDraft()}>Supprimer</button>
                  </>
                ) : (
                  <>
                    <button className="button primary" onClick={reply}>Répondre</button>
                    <button className="button" onClick={forward}>Transférer</button>
                    {folder === "trash" ? (
                      <button className="button" onClick={() => void moveMessage("untrash")}>
                        Restaurer
                      </button>
                    ) : (
                      <button className="button" onClick={() => void moveMessage("trash")}>
                        Mettre à la corbeille
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </section>
      </div>

      {composeOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1200,
            background: "rgba(15,23,42,.55)",
            display: "grid",
            placeItems: "center",
            padding: 18,
          }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !sending) setComposeOpen(false);
          }}
        >
          <div className="card" style={{ width: "min(760px, 100%)", maxHeight: "92vh", overflow: "auto", padding: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
              <div>
                <p className="eyebrow">MagniMail</p>
                <h2 style={{ marginTop: 0 }}>{compose.draftId ? "Modifier le brouillon" : "Nouveau message"}</h2>
              </div>
              <button className="button" disabled={sending} onClick={() => setComposeOpen(false)}>
                Fermer
              </button>
            </div>

            <div className="form">
              <div className="field">
                <label>À</label>
                <input
                  type="email"
                  value={compose.to}
                  onChange={(event) => setCompose({ ...compose, to: event.target.value })}
                  placeholder="client@exemple.com"
                  required
                />
              </div>
              <div className="grid2">
                <div className="field">
                  <label>Cc</label>
                  <input
                    type="email"
                    value={compose.cc}
                    onChange={(event) => setCompose({ ...compose, cc: event.target.value })}
                  />
                </div>
                <div className="field">
                  <label>Cci</label>
                  <input
                    type="email"
                    value={compose.bcc}
                    onChange={(event) => setCompose({ ...compose, bcc: event.target.value })}
                  />
                </div>
              </div>
              <div className="field">
                <label>Objet</label>
                <input
                  value={compose.subject}
                  onChange={(event) => setCompose({ ...compose, subject: event.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label>Message</label>
                <textarea
                  rows={12}
                  value={compose.body}
                  onChange={(event) => setCompose({ ...compose, body: event.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label>Pièces jointes</label>
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  onChange={(event) => setFiles(Array.from(event.target.files || []))}
                />
                {!!files.length && (
                  <small>{files.map((file) => file.name).join(" · ")}</small>
                )}
              </div>

              {feedback && (
                <div
                  style={{
                    padding: 12,
                    borderRadius: 10,
                    background: feedback.includes("envoyé") || feedback.includes("enregistré") ? "#f0fdf4" : "#fef2f2",
                  }}
                >
                  {feedback}
                </div>
              )}

              <div className="actions" style={{ justifyContent: "flex-end" }}>
                <button className="button" disabled={sending} onClick={() => void saveDraft()}>
                  Enregistrer le brouillon
                </button>
                <button
                  className="button primary"
                  disabled={sending || !compose.to.trim() || !compose.subject.trim() || !compose.body.trim()}
                  onClick={() => void send()}
                >
                  {sending ? "Traitement…" : "Envoyer"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
