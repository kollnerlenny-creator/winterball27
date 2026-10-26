// Minimaler SMTP-Client (über Cloudflare TCP Sockets), um Mails direkt über
// die LernSax-Adresse des Admins zu verschicken.
// Unterstützt Cloudflare Workers TCP Sockets mit implizitem TLS auf Port 465.

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
  return btoa(unescape(encodeURIComponent(str)));
}

function encodeSubject(subject) {
  return `=?UTF-8?B?${toBase64Safe(subject)}?=`;
}

function buildMimeMessage({ fromAddress, to, subject, text, html, attachments }) {
  const boundaryMixed = "mixed_" + crypto.randomUUID().replace(/-/g, "");
  const boundaryAlt = "alt_" + crypto.randomUUID().replace(/-/g, "");

  let msg = "";
  msg += `From: Winter Ball <${fromAddress}>\r\n`;
  msg += `To: ${to}\r\n`;
  msg += `Subject: ${encodeSubject(subject)}\r\n`;
  msg += `MIME-Version: 1.0\r\n`;
  msg += `Content-Type: multipart/mixed; boundary="${boundaryMixed}"\r\n\r\n`;
  msg += `--${boundaryMixed}\r\n`;
  msg += `Content-Type: multipart/alternative; boundary="${boundaryAlt}"\r\n\r\n`;
  msg += `--${boundaryAlt}\r\n`;
  msg += `Content-Type: text/plain; charset="UTF-8"\r\n`;
  msg += `Content-Transfer-Encoding: 8bit\r\n\r\n`;
  msg += `${text}\r\n\r\n`;
  msg += `--${boundaryAlt}\r\n`;
  msg += `Content-Type: text/html; charset="UTF-8"\r\n`;
  msg += `Content-Transfer-Encoding: 8bit\r\n\r\n`;
  msg += `${html}\r\n\r\n`;
  msg += `--${boundaryAlt}--\r\n`;

  for (const att of attachments || []) {
    msg += `--${boundaryMixed}\r\n`;
    msg += `Content-Type: application/pdf; name="${att.filename}"\r\n`;
    msg += `Content-Transfer-Encoding: base64\r\n`;
    msg += `Content-Disposition: attachment; filename="${att.filename}"\r\n\r\n`;
    msg += chunkBase64(att.content) + `\r\n`;
  }
  msg += `--${boundaryMixed}--\r\n`;

  return dotStuff(msg);
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
    await socket.opened;
  }

  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  async function readResponse() {
    let data = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      data += decoder.decode(value, { stream: true });
      const lines = data.trim().split("\r\n");
      const last = lines[lines.length - 1];
      if (last && /^\d{3} /.test(last)) break; // letzte Zeile einer Mehrzeilenantwort erkannt
    }
    return data;
  }

  async function send(line) {
    await writer.write(encoder.encode(line + "\r\n"));
  }

  try {
    const greeting = await readResponse(); // Begrüßung (220)
    if (!greeting.startsWith("220")) {
      throw new Error("Unerwartete Server-Begrüßung: " + greeting);
    }

    await send(`EHLO winterball27.de`);
    const ehloResp = await readResponse();
    if (!ehloResp.includes("250")) {
      throw new Error("EHLO abgelehnt: " + ehloResp);
    }

    await send(`AUTH LOGIN`);
    const authPrompt1 = await readResponse();
    if (!authPrompt1.startsWith("334")) {
      throw new Error("AUTH LOGIN nicht akzeptiert: " + authPrompt1);
    }

    await send(toBase64Safe(user));
    const authPrompt2 = await readResponse();
    if (!authPrompt2.startsWith("334")) {
      throw new Error("Benutzername nicht akzeptiert: " + authPrompt2);
    }

    await send(toBase64Safe(pass));
    const authResp = await readResponse();
    if (!authResp.includes("235")) {
      throw new Error("LernSax-Login fehlgeschlagen (Passwort oder Benutzer ungültig): " + authResp.trim());
    }

    await send(`MAIL FROM:<${user}>`);
    const mailResp = await readResponse();
    if (!mailResp.includes("250")) {
      throw new Error("MAIL FROM abgelehnt: " + mailResp.trim());
    }

    await send(`RCPT TO:<${to}>`);
    const rcptResp = await readResponse();
    if (!rcptResp.includes("250")) {
      throw new Error("Empfänger abgelehnt: " + rcptResp.trim());
    }

    await send(`DATA`);
    const dataPrompt = await readResponse();
    if (!dataPrompt.includes("354")) {
      throw new Error("DATA abgelehnt: " + dataPrompt.trim());
    }

    const mime = buildMimeMessage({ fromAddress: user, to, subject, text, html, attachments });
    await writer.write(encoder.encode(mime + "\r\n.\r\n"));
    const dataResp = await readResponse();
    if (!dataResp.includes("250")) {
      throw new Error("Versand fehlgeschlagen: " + dataResp.trim());
    }

    await send(`QUIT`);
  } finally {
    try { await writer.close(); } catch (e) {}
    try { socket.close(); } catch (e) {}
  }
}
