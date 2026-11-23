// Minimaler SMTP- & IMAPS-Client (über Cloudflare TCP Sockets), um Mails direkt über
// die LernSax-Adresse des Admins zu verschicken UND eine Kopie im Ordner "Gesendet" abzulegen.
// Unterstützt Cloudflare Workers TCP Sockets mit implizitem TLS (Port 465 SMTP, Port 993 IMAPS).

import { connect } from "cloudflare:sockets";

function dotStuff(msg) {
  return msg.split("\r\n").map(line => (line.startsWith(".") ? "." + line : line)).join("\r\n");
}

function chunkBase64(b64) {
  const lines = [];
  for (let i = 0; i < b64.length; i += 76) lines.push(b64.slice(i, i + 76));
  return lines.join("\r\n");
}

// UTF-8 sichere Base64-Codierung (stürzt bei Umlauten & Sonderzeichen nicht ab)
function toBase64Safe(str) {
  const bytes = new TextEncoder().encode(String(str || ""));
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function encodeSubject(subject) {
  return `=?UTF-8?B?${toBase64Safe(subject)}?=`;
}

function sanitizeHeaderValue(val) {
  return String(val || "").replace(/[\r\n]+/g, " ").trim();
}

function normalizeCrlf(str) {
  return String(str || "").replace(/\r?\n/g, "\r\n");
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Zeitüberschreitung (${label})`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function buildMimeMessage({ fromAddress, to, subject, text, html, attachments }) {
  const boundaryMixed = "mixed_" + crypto.randomUUID().replace(/-/g, "");
  const boundaryAlt = "alt_" + crypto.randomUUID().replace(/-/g, "");
  const cleanFrom = sanitizeHeaderValue(fromAddress);
  const cleanTo = sanitizeHeaderValue(to);
  const cleanSubject = sanitizeHeaderValue(subject);
  const domainPart = (cleanFrom.split("@")[1] || "gymwilsdruff.lernsax.de").replace(/[^a-zA-Z0-9.-]/g, "");
  const messageId = `<${crypto.randomUUID()}@${domainPart}>`;
  const dateHeader = new Date().toUTCString();

  let msg = "";
  msg += `From: Winter Ball <${cleanFrom}>\r\n`;
  msg += `To: ${cleanTo}\r\n`;
  msg += `Subject: ${encodeSubject(cleanSubject)}\r\n`;
  msg += `Date: ${dateHeader}\r\n`;
  msg += `Message-ID: ${messageId}\r\n`;
  msg += `MIME-Version: 1.0\r\n`;
  msg += `Content-Type: multipart/mixed; boundary="${boundaryMixed}"\r\n\r\n`;
  msg += `--${boundaryMixed}\r\n`;
  msg += `Content-Type: multipart/alternative; boundary="${boundaryAlt}"\r\n\r\n`;
  msg += `--${boundaryAlt}\r\n`;
  msg += `Content-Type: text/plain; charset="UTF-8"\r\n`;
  msg += `Content-Transfer-Encoding: 8bit\r\n\r\n`;
  msg += `${normalizeCrlf(text)}\r\n\r\n`;
  msg += `--${boundaryAlt}\r\n`;
  msg += `Content-Type: text/html; charset="UTF-8"\r\n`;
  msg += `Content-Transfer-Encoding: 8bit\r\n\r\n`;
  msg += `${normalizeCrlf(html)}\r\n\r\n`;
  msg += `--${boundaryAlt}--\r\n`;

  for (const att of attachments || []) {
    const cleanFilename = sanitizeHeaderValue(att.filename || "ticket.pdf").replace(/"/g, "");
    msg += `--${boundaryMixed}\r\n`;
    msg += `Content-Type: application/pdf; name="${cleanFilename}"\r\n`;
    msg += `Content-Transfer-Encoding: base64\r\n`;
    msg += `Content-Disposition: attachment; filename="${cleanFilename}"\r\n\r\n`;
    msg += chunkBase64(att.content || "") + `\r\n`;
  }
  msg += `--${boundaryMixed}--\r\n`;

  return {
    rawMime: msg,
    smtpMessage: dotStuff(msg)
  };
}

function escapeImapQuoted(str) {
  return String(str || "")
    .replace(/[\r\n]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

function parseListMailbox(line) {
  // Beispiel: * LIST (\HasNoChildren \Sent) "." "Gesendet"
  const m = line.match(/^\*\s+LIST\s+\(([^)]*)\)\s+(?:"([^"]*)"|NIL)\s+(.+)$/i);
  if (!m) return null;
  const flags = m[1] || "";
  let name = m[3].trim();
  if (name.startsWith('"') && name.endsWith('"')) {
    name = name.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  const hasSentFlag = /\\Sent\b/i.test(flags);
  return { flags, name, hasSentFlag };
}

async function saveCopyToSent(host, user, pass, rawMime) {
  const socket = connect({ hostname: host, port: 993 }, { secureTransport: "on" });
  if (socket.opened) {
    await withTimeout(socket.opened, 6000, "IMAP TLS-Handshake");
  }

  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let tagCounter = 1;

  const nextTag = () => `A${String(tagCounter++).padStart(3, "0")}`;

  async function readLine() {
    while (true) {
      const idx = buffer.indexOf("\r\n");
      if (idx !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        return line;
      }
      const { value, done } = await withTimeout(reader.read(), 7000, "IMAP Lesen");
      if (done) {
        throw new Error("IMAP-Verbindung unerwartet geschlossen");
      }
      buffer += decoder.decode(value, { stream: true });
    }
  }

  async function writeLine(cmd) {
    await withTimeout(writer.write(encoder.encode(cmd + "\r\n")), 6000, "IMAP Schreiben");
  }

  async function readUntilTag(tag) {
    const untagged = [];
    while (true) {
      const line = await readLine();
      if (line.startsWith(tag + " ")) {
        return { statusLine: line, untagged };
      }
      untagged.push(line);
    }
  }

  async function readContinuationOrTag(tag) {
    const untagged = [];
    while (true) {
      const line = await readLine();
      if (line.startsWith("+")) {
        return { continuation: line, untagged };
      }
      if (line.startsWith(tag + " ")) {
        return { statusLine: line, untagged };
      }
      untagged.push(line);
    }
  }

  try {
    const greeting = await readLine();
    if (!/^\*\s+(OK|PREAUTH)/i.test(greeting)) {
      throw new Error("Unerwartete IMAP-Begrüßung: " + greeting);
    }

    const loginTag = nextTag();
    await writeLine(`${loginTag} LOGIN "${escapeImapQuoted(user)}" "${escapeImapQuoted(pass)}"`);
    const loginResp = await readUntilTag(loginTag);
    if (!loginResp.statusLine.startsWith(`${loginTag} OK`)) {
      throw new Error("IMAP-Login fehlgeschlagen: " + loginResp.statusLine);
    }

    // Gesendet-Ordner ermitteln (per \Sent-Attribut oder Namensabgleich)
    const listTag = nextTag();
    await writeLine(`${listTag} LIST "" "*"`);
    const listResp = await readUntilTag(listTag);
    const parsedFolders = listResp.untagged
      .map(parseListMailbox)
      .filter(Boolean);

    const flaggedSent = parsedFolders.filter(f => f.hasSentFlag).map(f => f.name);
    const namedSent = parsedFolders
      .filter(f => /^(inbox[./])?(gesendet|sent|sent items|sent messages)$/i.test(f.name))
      .map(f => f.name);

    const candidates = Array.from(new Set([
      ...flaggedSent,
      ...namedSent,
      "Sent",
      "Gesendet",
      "INBOX.Sent",
      "INBOX.Gesendet",
      "Sent Items",
      "Sent Messages"
    ]));

    const mimeBytes = encoder.encode(rawMime);
    let savedFolder = null;
    let lastAppendErr = null;

    for (const folder of candidates) {
      const appendTag = nextTag();
      await writeLine(`${appendTag} APPEND "${escapeImapQuoted(folder)}" (\\Seen) {${mimeBytes.byteLength}}`);
      const cont = await readContinuationOrTag(appendTag);

      if (cont.statusLine) {
        lastAppendErr = cont.statusLine;
        continue;
      }

      await withTimeout(writer.write(mimeBytes), 8000, "IMAP APPEND Daten");
      await withTimeout(writer.write(encoder.encode("\r\n")), 4000, "IMAP APPEND Abschluss");

      const doneResp = await readUntilTag(appendTag);
      if (doneResp.statusLine.startsWith(`${appendTag} OK`)) {
        savedFolder = folder;
        break;
      }
      lastAppendErr = doneResp.statusLine;
    }

    const logoutTag = nextTag();
    try {
      await writeLine(`${logoutTag} LOGOUT`);
    } catch (_) {}

    if (!savedFolder) {
      throw new Error("Kein passender Gesendet-Ordner gefunden (" + (lastAppendErr || "unbekannt") + ")");
    }

    return { savedToSent: true, sentFolder: savedFolder };
  } finally {
    try { await writer.close(); } catch (_) {}
    try { socket.close(); } catch (_) {}
  }
}

export async function sendViaLernSax(env, { to, subject, text, html, attachments }) {
  const host = "mail.lernsax.de";
  const port = 465;

  // Flexible Variablen-Namen (unterstützt LERNSAX_EMAIL, LERNSAX_USER, LERNSAX_PASSWORD, LERNSAX_PASS)
  const user = (env.LERNSAX_EMAIL || env.LERNSAX_USER || "").trim();
  const pass = (env.LERNSAX_PASSWORD || env.LERNSAX_PASS || "").trim();

  if (!user || !pass) {
    throw new Error(`LernSax-Zugangsdaten fehlen in Cloudflare: LERNSAX_EMAIL/USER gesetzt: ${!!user}, LERNSAX_PASSWORD/PASS gesetzt: ${!!pass}`);
  }

  // Socket aufbauen mit implizitem TLS für Port 465
  const socket = connect({ hostname: host, port }, { secureTransport: "on" });

  // WICHTIG in Cloudflare Workers: Auf Abschluss des TLS-Handshakes warten!
  if (socket.opened) {
    await withTimeout(socket.opened, 6000, "SMTP TLS-Handshake");
  }

  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  async function readResponse(stepLabel = "SMTP Antwort", timeoutMs = 20000) {
    let data = "";
    while (true) {
      const { value, done } = await withTimeout(reader.read(), timeoutMs, stepLabel);
      if (done) {
        if (data.trim()) break;
        throw new Error(`SMTP-Verbindung unerwartet geschlossen (${stepLabel})`);
      }
      data += decoder.decode(value, { stream: true });
      if (/\r?\n$/.test(data)) {
        const lines = data.replace(/\r?\n$/, "").split(/\r?\n/);
        const last = lines[lines.length - 1];
        if (last && /^\d{3}(?: |$)/.test(last)) break; // letzte Zeile einer Mehrzeilenantwort erkannt
      }
    }
    return data;
  }

  async function send(line, stepLabel = "SMTP Senden") {
    await withTimeout(writer.write(encoder.encode(line + "\r\n")), 10000, stepLabel);
  }

  let mimePair;
  try {
    const greeting = await readResponse("SMTP Begrüßung (220)", 20000); // Begrüßung (220)
    if (!greeting.startsWith("220")) {
      throw new Error("Unerwartete Server-Begrüßung: " + greeting);
    }

    await send(`EHLO winterball27.de`, "SMTP EHLO Senden");
    const ehloResp = await readResponse("SMTP EHLO Antwort", 15000);
    if (!ehloResp.includes("250")) {
      throw new Error("EHLO abgelehnt: " + ehloResp);
    }

    await send(`AUTH LOGIN`, "SMTP AUTH LOGIN");
    const authPrompt1 = await readResponse("SMTP AUTH Antwort", 15000);
    if (!authPrompt1.startsWith("334")) {
      throw new Error("AUTH LOGIN nicht akzeptiert: " + authPrompt1);
    }

    await send(toBase64Safe(user), "SMTP Benutzer Senden");
    const authPrompt2 = await readResponse("SMTP Benutzer Antwort", 15000);
    if (!authPrompt2.startsWith("334")) {
      throw new Error("Benutzername nicht akzeptiert: " + authPrompt2);
    }

    await send(toBase64Safe(pass), "SMTP Passwort Senden");
    const authResp = await readResponse("SMTP Login Antwort", 15000);
    if (!authResp.includes("235")) {
      throw new Error("LernSax-Login fehlgeschlagen (Passwort oder Benutzer ungültig): " + authResp.trim());
    }

    await send(`MAIL FROM:<${user}>`, "SMTP MAIL FROM Senden");
    const mailResp = await readResponse("SMTP MAIL FROM Antwort", 15000);
    if (!mailResp.includes("250")) {
      throw new Error("MAIL FROM abgelehnt: " + mailResp.trim());
    }

    const cleanRecipient = sanitizeHeaderValue(to).replace(/^.*<([^>]+)>.*$/, "$1");
    await send(`RCPT TO:<${cleanRecipient}>`, "SMTP RCPT TO Senden");
    const rcptResp = await readResponse("SMTP Empfänger-Prüfung (RCPT TO)", 20000);
    if (!rcptResp.includes("250")) {
      throw new Error("Empfänger abgelehnt: " + rcptResp.trim());
    }

    await send(`DATA`, "SMTP DATA Start");
    const dataPrompt = await readResponse("SMTP DATA Bereitschaft", 15000);
    if (!dataPrompt.includes("354")) {
      throw new Error("DATA abgelehnt: " + dataPrompt.trim());
    }

    mimePair = buildMimeMessage({ fromAddress: user, to: cleanRecipient, subject, text, html, attachments });
    await withTimeout(writer.write(encoder.encode(mimePair.smtpMessage + "\r\n.\r\n")), 15000, "SMTP Nachricht Senden");
    const dataResp = await readResponse("SMTP Versand-Abschluss (DATA)", 25000);
    if (!dataResp.includes("250")) {
      throw new Error("Versand fehlgeschlagen: " + dataResp.trim());
    }

    await send(`QUIT`, "SMTP QUIT");
  } finally {
    try { await writer.close(); } catch (_) {}
    try { socket.close(); } catch (_) {}
  }

  // Nach erfolgreichem SMTP-Versand eine Kopie im IMAP-Ordner "Gesendet" speichern,
  // damit man im LernSax-Postfach direkt prüfen kann, ob die Mail rausgegangen ist.
  let savedToSent = false;
  let sentFolder = null;
  let sentError = null;
  try {
    const imapRes = await saveCopyToSent(host, user, pass, mimePair.rawMime);
    savedToSent = !!imapRes.savedToSent;
    sentFolder = imapRes.sentFolder || null;
  } catch (imapErr) {
    sentError = imapErr?.message || String(imapErr);
  }

  return {
    ok: true,
    via: "lernsax",
    savedToSent,
    sentFolder,
    sentError
  };
}
