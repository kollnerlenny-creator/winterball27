// Cloudflare Worker: verschickt Bestätigungs- und Ticket-Mails über Brevo.
// Tickets werden zusätzlich als PDF generiert und der Mail angehängt.
// Jede Mail hat sowohl HTML- als auch Text-Version (für Mail-Programme ohne HTML).

import {
  PDFDocument, StandardFonts, rgb,
  pushGraphicsState, popGraphicsState,
  moveTo, lineTo, appendQuadraticCurve, closePath, clip, endPath,
} from "pdf-lib";
import { sendViaLernSax } from "./smtp.js";
import { TICKET_BG_JPG_BASE64 } from "./ticket-bg.js";
import { WALLET_LOGO_PNG_BASE64, WALLET_HERO_JPG_BASE64 } from "./wallet-images.js";
import { verifyFirebaseIdToken } from "./verify-token.js";

const FIREBASE_PROJECT_ID = "winterball-27";

const ALLOWED_ORIGINS = [
  "https://winterball27.de",
  "https://www.winterball27.de",
  "https://karte.winterball27.de",
  "https://admin.winterball27.de",
  "https://scanner.winterball27.de",
  "https://kasse.winterball27.de",
];

let currentOrigin = null; // wird pro Request am Anfang von fetch() gesetzt

function corsHeaders() {
  const allowOrigin = ALLOWED_ORIGINS.includes(currentOrigin) ? currentOrigin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Vary": "Origin",
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...corsHeaders(), "Content-Type": "application/json" },
  });
}

// Ermittelt, ob eine formelle Anrede (Sie) gewünscht ist
function isFormalSalutation(payload = {}) {
  if (payload.isFormal === true || payload.formell === true) return true;
  const s = String(payload.salutation || payload.anrede || '').trim().toLowerCase();
  return s === 'sie';
}

// Wertet eine fehlgeschlagene Brevo-Antwort aus
async function describeBrevoError(brevoRes) {
  let bodyText = "";
  try {
    bodyText = await brevoRes.text();
  } catch (e) {
    bodyText = brevoRes.statusText || "";
  }
  console.error("Brevo error:", brevoRes.status, bodyText);

  let parsedMsg = "";
  try {
    const errObj = JSON.parse(bodyText);
    parsedMsg = errObj.message || errObj.code || "";
  } catch (_) {}

  const isQuotaError =
    brevoRes.status === 429 ||
    bodyText.includes("daily_quota") ||
    bodyText.includes("rate_limit") ||
    bodyText.includes("unable_to_send");

  if (isQuotaError) {
    return "Brevo-Tageslimit erreicht (Free-Plan: max. 300 Mails/Tag). Die Anmeldung/Zahlung ist trotzdem gespeichert — das Ticket kann später über den PDF-Button im Dashboard nachgereicht werden.";
  }
  return `Brevo-Fehler (${brevoRes.status}): ${parsedMsg || bodyText || "Unbekannter Fehler"}`;
}

function parseSender(senderString) {
  const match = senderString.match(/^(.*)<(.+)>$/);
  if (match) return { name: match[1].trim(), email: match[2].trim() };
  return { name: "Winter Ball", email: senderString.trim() };
}

async function requireAdmin(request) {
  const authHeader = request.headers.get("Authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!idToken) throw new Error("Kein Login-Token übergeben");
  await verifyFirebaseIdToken(idToken, FIREBASE_PROJECT_ID);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Grußformel: passt sich an Einzahl/Mehrzahl und Du/Sie an
function signoffHtml(plural, formal = false) {
  let line = plural ? 'Wir freuen uns auf euch!' : 'Wir freuen uns auf dich!';
  let klasse = plural ? 'Eure Klassenstufe 12' : 'Deine Klassenstufe 12';

  if (formal) {
    line = 'Wir freuen uns auf Ihren Besuch!';
    klasse = 'Ihre Klassenstufe 12';
  }

  return `
    <div style="color:#eef2fb;font-size:14px;margin-top:18px;">${line}<br><br>${klasse}</div>
    <div style="color:#7c8aa3;font-size:12.5px;margin-top:16px;">
      Fragen? <a href="mailto:info@winterball27.de" style="color:#9db4ff;text-decoration:none;">info@winterball27.de</a>
    </div>
    <div style="color:#5c6b88;font-size:11px;margin-top:16px;line-height:1.5;">
      Konzeption, Design &amp; technische Umsetzung:<br>
      <span style="color:#8a99b5;font-weight:500;">Lenny Köllner</span>
    </div>`;
}

function signoffText(plural, formal = false) {
  let line = plural ? 'Wir freuen uns auf euch!' : 'Wir freuen uns auf dich!';
  let klasse = plural ? 'Eure Klassenstufe 12' : 'Deine Klassenstufe 12';

  if (formal) {
    line = 'Wir freuen uns auf Ihren Besuch!';
    klasse = 'Ihre Klassenstufe 12';
  }

  return `${line}\n\n${klasse}\n\nWebsite: https://winterball27.de\nFragen? info@winterball27.de\n\nKonzeption, Design & technische Umsetzung:\nLenny Köllner`;
}

function wrongRecipientHtml(formal = false) {
  const instruction = formal
    ? 'bitte löschen Sie die Mail in dem Fall einfach.'
    : 'bitte lösche die Mail in dem Fall einfach.';
  return `<div style="color:#6c7994;font-size:11px;margin-top:16px;line-height:1.6;border-top:1px solid rgba(255,255,255,0.08);padding-top:12px;">Diese Mail irrtümlich erhalten und selbst nichts bestellt? Dann hat sich vermutlich jemand bei der E-Mail-Adresse vertippt — ${instruction}</div>`;
}

function wrongRecipientText(formal = false) {
  const instruction = formal
    ? 'bitte löschen Sie die Mail in dem Fall einfach.'
    : 'bitte lösche die Mail in dem Fall einfach.';
  return `\nDiese Mail irrtümlich erhalten und selbst nichts bestellt? Dann hat sich vermutlich jemand bei der E-Mail-Adresse vertippt — ${instruction}\n`;
}

function noCancelHtml(plural, formal = false) {
  let text = '';
  if (formal) {
    text = plural
      ? 'Ihre Tickets sind mit der Bezahlung verbindlich gebucht und können nicht mehr storniert oder erstattet werden.'
      : 'Ihr Ticket ist mit der Bezahlung verbindlich gebucht und kann nicht mehr storniert oder erstattet werden.';
  } else {
    text = plural
      ? 'Eure Tickets sind mit der Bezahlung verbindlich gebucht und können nicht mehr storniert oder erstattet werden.'
      : 'Dein Ticket ist mit der Bezahlung verbindlich gebucht und kann nicht mehr storniert oder erstattet werden.';
  }
  return `<div style="color:#eef2fb;font-size:12.5px;margin-top:14px;line-height:1.6;background:rgba(255,210,127,0.1);border:1px solid rgba(255,210,127,0.25);border-radius:10px;padding:10px 14px;">⚠️ ${text}</div>`;
}

function noCancelText(plural, formal = false) {
  let text = '';
  if (formal) {
    text = plural
      ? 'Ihre Tickets sind mit der Bezahlung verbindlich gebucht und können nicht mehr storniert oder erstattet werden.'
      : 'Ihr Ticket ist mit der Bezahlung verbindlich gebucht und kann nicht mehr storniert oder erstattet werden.';
  } else {
    text = plural
      ? 'Eure Tickets sind mit der Bezahlung verbindlich gebucht und können nicht mehr storniert oder erstattet werden.'
      : 'Dein Ticket ist mit der Bezahlung verbindlich gebucht und kann nicht mehr storniert oder erstattet werden.';
  }
  return `\nHinweis: ${text}\n`;
}

// ---------- PDF-Ticket-Generierung ----------

async function fetchQrPng(ticketId) {
  const url = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&margin=20&color=10-14-26&bgcolor=242-245-250&data=${encodeURIComponent(ticketId)}`;
  const res = await fetch(url);
  return new Uint8Array(await res.arrayBuffer());
}

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function roundedRectClipOps(x, y, width, height, r) {
  return [
    moveTo(x + r, y),
    lineTo(x + width - r, y),
    appendQuadraticCurve(x + width, y, x + width, y + r),
    lineTo(x + width, y + height - r),
    appendQuadraticCurve(x + width, y + height, x + width - r, y + height),
    lineTo(x + r, y + height),
    appendQuadraticCurve(x, y + height, x, y + height - r),
    lineTo(x, y + r),
    appendQuadraticCurve(x, y, x + r, y),
    closePath(),
    clip(),
    endPath(),
  ];
}

function roundedRectPath(w, h, r) {
  return `M ${r} 0 H ${w - r} A ${r} ${r} 0 0 1 ${w} ${r} V ${h - r} A ${r} ${r} 0 0 1 ${w - r} ${h} H ${r} A ${r} ${r} 0 0 1 0 ${h - r} V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`;
}

async function buildTicketsPdf(attendees) {
  const pdfDoc = await PDFDocument.create();

  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const bgImage = await pdfDoc.embedJpg(base64ToUint8Array(TICKET_BG_JPG_BASE64));

  const width = 600;
  const height = 194.1;

  const scale = width / 2000;
  const boxLeft = 1387 * scale;
  const boxRight = 1965 * scale;
  const boxTopImg = 27 * scale;
  const boxBottomImg = 619 * scale;
  const boxTop = height - boxTopImg;
  const boxBottom = height - boxBottomImg;
  const boxCenterX = (boxLeft + boxRight) / 2;

  for (const attendee of attendees) {
    const page = pdfDoc.addPage([width, height]);
    page.drawImage(bgImage, { x: 0, y: 0, width, height });

    const qrBytes = await fetchQrPng(attendee.ticketId);
    const qrImage = await pdfDoc.embedPng(qrBytes);

    const qrSize = 72;
    const qrRadius = 10;

    const gapCardToName = 34;
    const nameSize = 13;
    const gapNameToCategory = 10;
    const catSize = 8;
    const gapCategoryToTicket = 13;
    const ticketSize = 7;

    const qrX = boxCenterX - qrSize / 2;
    const qrY = height / 2 - qrSize / 2 + 15;

    const cardPad = 9;
    const cardW = qrSize + cardPad * 2;
    const cardH = qrSize + cardPad * 2;
    const cardX = qrX - cardPad;
    const cardY = qrY - cardPad;

    page.drawSvgPath(roundedRectPath(cardW + 10, cardH + 10, qrRadius + 8), {
      x: cardX - 5, y: cardY + cardH + 5, color: rgb(0.56, 0.71, 1), opacity: 0.18,
    });
    page.drawSvgPath(roundedRectPath(cardW, cardH, qrRadius + 4), {
      x: cardX, y: cardY + cardH, color: rgb(0.97, 0.98, 1),
      borderColor: rgb(0.56, 0.71, 1), borderWidth: 1.2,
    });

    page.pushOperators(
      pushGraphicsState(),
      ...roundedRectClipOps(qrX, qrY, qrSize, qrSize, qrRadius),
    );
    page.drawImage(qrImage, { x: qrX, y: qrY, width: qrSize, height: qrSize });
    page.pushOperators(popGraphicsState());

    const centerText = (text, y, size, font, color) => {
      page.drawText(text, {
        x: boxCenterX - font.widthOfTextAtSize(text, size) / 2,
        y, size, font, color,
      });
    };

    const nameY = qrY - gapCardToName;
    centerText(attendee.name, nameY, nameSize, fontBold, rgb(1, 1, 1));

    if (attendee.category) {
      const catLabel = attendee.category === 'u18' ? 'Unter 18' : '18 oder älter';
      centerText(catLabel, nameY - gapNameToCategory, catSize, fontRegular, rgb(0.85, 0.87, 0.92));
    }

    const ticketY = nameY - gapNameToCategory - gapCategoryToTicket;
    centerText(`Ticket-ID: ${attendee.ticketId}`, ticketY, ticketSize, fontRegular, rgb(0.75, 0.78, 0.85));
  }

  return pdfDoc.save();
}

function uint8ToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// ---------- Quittung (PDF, nach Bezahlung) ----------

function receiptNumberFor(attendees) {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const ref = (attendees[0]?.ticketId || '').split('-').pop() || '0000';
  return `QU-${stamp}-${ref}`;
}

async function buildInvoicePdf({ ordererName, attendees }) {
  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const width = 595.28, height = 841.89; // A4 in pt
  const page = pdfDoc.addPage([width, height]);
  const marginX = 56;
  let y = height - 70;

  const navy = rgb(0.039, 0.055, 0.102);
  const dim = rgb(0.45, 0.48, 0.55);
  const line = rgb(0.85, 0.86, 0.89);

  page.drawText('Winter Ball 2027', { x: marginX, y, size: 13, font: fontBold, color: navy });
  y -= 16;
  page.drawText('Klassenstufe 12 · Gymnasium Wilsdruff', { x: marginX, y, size: 9, font: fontRegular, color: dim });

  y -= 50;
  page.drawText('Quittung', { x: marginX, y, size: 24, font: fontBold, color: navy });

  const receiptNumber = receiptNumberFor(attendees);
  const issuedAt = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const rightX = width - marginX;
  const rightLabel = (label, value, yy) => {
    const text = `${label}: ${value}`;
    page.drawText(text, { x: rightX - fontRegular.widthOfTextAtSize(text, 10), y: yy, size: 10, font: fontRegular, color: dim });
  };
  rightLabel('Quittungsnummer', receiptNumber, y + 6);
  rightLabel('Datum', issuedAt, y - 8);

  y -= 40;
  page.drawText('Zahler / Besteller', { x: marginX, y, size: 9, font: fontRegular, color: dim });
  y -= 16;
  page.drawText(ordererName, { x: marginX, y, size: 12, font: fontBold, color: navy });

  y -= 40;
  page.drawLine({ start: { x: marginX, y }, end: { x: rightX, y }, thickness: 1, color: line });
  y -= 22;

  const colName = marginX, colCat = marginX + 260, colPrice = rightX - 60;
  page.drawText('Ticket für', { x: colName, y, size: 9.5, font: fontBold, color: dim });
  page.drawText('Kategorie', { x: colCat, y, size: 9.5, font: fontBold, color: dim });
  page.drawText('Preis', { x: colPrice, y, size: 9.5, font: fontBold, color: dim });
  y -= 10;
  page.drawLine({ start: { x: marginX, y }, end: { x: rightX, y }, thickness: 0.5, color: line });
  y -= 20;

  let total = 0;
  for (const a of attendees) {
    const price = Number(a.price || 0);
    total += price;
    const catLabel = a.category === 'u18' ? 'Unter 18' : '18 oder älter';
    page.drawText(a.name, { x: colName, y, size: 11, font: fontRegular, color: navy });
    page.drawText(catLabel, { x: colCat, y, size: 11, font: fontRegular, color: navy });
    const priceStr = `${price.toFixed(2).replace('.', ',')} €`;
    page.drawText(priceStr, { x: rightX - fontRegular.widthOfTextAtSize(priceStr, 11), y, size: 11, font: fontRegular, color: navy });
    y -= 22;
  }

  y -= 6;
  page.drawLine({ start: { x: marginX, y }, end: { x: rightX, y }, thickness: 1, color: line });
  y -= 24;

  const totalLabel = 'Gesamtbetrag';
  const totalStr = `${total.toFixed(2).replace('.', ',')} €`;
  page.drawText(totalLabel, { x: colCat, y, size: 13, font: fontBold, color: navy });
  page.drawText(totalStr, { x: rightX - fontBold.widthOfTextAtSize(totalStr, 13), y, size: 13, font: fontBold, color: navy });

  y -= 40;
  page.drawText('Zahlungsart: Barzahlung an der Vorverkaufskasse in der Schule.', { x: marginX, y, size: 9.5, font: fontRegular, color: dim });
  y -= 30;

  const noteLines = [
    'Hinweis: Ticket-Verkäufe für Veranstaltungen mit festem Termin sind laut § 312g Abs. 2 Nr. 9',
    'BGB vom gesetzlichen Widerrufsrecht ausgenommen. Das gebuchte Ticket ist mit der Bezahlung',
    'verbindlich und kann nicht mehr storniert oder erstattet werden.',
  ];
  noteLines.forEach(l => {
    page.drawText(l, { x: marginX, y, size: 8.5, font: fontRegular, color: dim });
    y -= 12;
  });

  y -= 20;
  page.drawText('Fragen? info@winterball27.de · winterball27.de', { x: marginX, y, size: 9, font: fontRegular, color: dim });

  return pdfDoc.save();
}

// ---------- Bestätigungsmail (bei Anmeldung) ----------

function buildConfirmationEmailHtml({ name, attendeeNames, formal, greeting }) {
  const others = attendeeNames.filter(n => n !== name);
  const plural = attendeeNames.length > 1;
  const othersLine = others.length
    ? `<div style="color:#9aa7c2;font-size:14px;margin-top:6px;">Mit dabei: ${others.map(escapeHtml).join(', ')}</div>`
    : '';

  const greetingLine = greeting
    ? escapeHtml(greeting)
    : (formal ? `Guten Tag ${escapeHtml(name)},` : `Hallo ${escapeHtml(name)},`);

  const introText = formal
    ? (plural ? 'Ihre Anmeldungen sind bei uns eingegangen.' : 'Ihre Anmeldung ist bei uns eingegangen.')
    : (plural ? 'eure Anmeldungen sind bei uns eingegangen.' : 'deine Anmeldung ist bei uns eingegangen.');

  const payText = formal
    ? `Bitte bezahlen Sie ${plural ? 'die Tickets' : 'Ihr Ticket'} bar an der Vorverkaufskasse in der Schule. Sobald das erledigt ist, erhalten Sie ${plural ? 'die Tickets' : 'Ihr Ticket'} mit QR-Code in einer separaten Mail zugeschickt.`
    : `Bitte bezahle ${plural ? 'die Tickets' : 'dein Ticket'} bar an der Vorverkaufskasse in der Schule. Sobald das erledigt ist, bekommst du ${plural ? 'die Tickets' : 'dein Ticket'} mit QR-Code in einer separaten Mail zugeschickt.`;

  return `
  <div style="background:#0a0e1a;padding:40px 16px;font-family:'Segoe UI',system-ui,sans-serif;">
    <div style="max-width:420px;margin:0 auto;background:linear-gradient(180deg,#131c30,#1c2a45);border-radius:20px;overflow:hidden;border:1px solid rgba(255,255,255,0.1);">
      <div style="padding:36px 28px;text-align:center;">
        <div style="color:#eef2fb;font-size:13px;letter-spacing:2px;text-transform:uppercase;opacity:0.6;margin-bottom:4px;">Anmeldung eingegangen</div>
        <div style="margin-bottom:16px;">
          <a href="https://winterball27.de" target="_blank" rel="noopener noreferrer" style="color:#ffffff;text-decoration:none;font-size:30px;font-style:italic;font-family:Georgia,serif;">Winter Ball</a>
        </div>
        <div style="color:#eef2fb;font-size:16px;margin-top:8px;">${greetingLine}</div>
        <div style="color:#9aa7c2;font-size:14px;margin-top:10px;line-height:1.7;text-align:left;">
          ${introText}${othersLine}<br><br>
          ${payText}
        </div>
        
        <!-- Button zur Website -->
        <div style="margin:26px 0 16px;text-align:center;">
          <a href="https://winterball27.de" target="_blank" rel="noopener noreferrer" 
             style="background:#8fb4ff;background:linear-gradient(135deg,#8fb4ff,#c2d8ff);color:#0a0e1a;padding:13px 30px;border-radius:100px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block;letter-spacing:0.3px;box-shadow:0 6px 20px rgba(143,180,255,0.35);">
            winterball27.de besuchen &rarr;
          </a>
        </div>

        <div style="color:#eef2fb;font-size:15px;margin-top:20px;">30. Januar 2027 · 17:30 Uhr</div>
        ${signoffHtml(plural, formal)}
        ${wrongRecipientHtml(formal)}
      </div>
    </div>
  </div>`;
}

function buildConfirmationEmailText({ name, attendeeNames, formal, greeting }) {
  const others = attendeeNames.filter(n => n !== name);
  const plural = attendeeNames.length > 1;
  const othersLine = others.length ? `\nMit dabei: ${others.join(', ')}\n` : '';

  const greetingLine = greeting
    ? greeting
    : (formal ? `Guten Tag ${name},` : `Hallo ${name},`);

  const introText = formal
    ? (plural ? 'Ihre Anmeldungen sind bei uns eingegangen.' : 'Ihre Anmeldung ist bei uns eingegangen.')
    : (plural ? 'eure Anmeldungen sind bei uns eingegangen.' : 'deine Anmeldung ist bei uns eingegangen.');

  const payText = formal
    ? `Bitte bezahlen Sie ${plural ? 'die Tickets' : 'Ihr Ticket'} bar an der Vorverkaufskasse in der Schule.\nSobald das erledigt ist, erhalten Sie ${plural ? 'die Tickets' : 'Ihr Ticket'} mit QR-Code in einer separaten Mail zugeschickt.`
    : `Bitte bezahle ${plural ? 'die Tickets' : 'dein Ticket'} bar an der Vorverkaufskasse in der Schule.\nSobald das erledigt ist, bekommst du ${plural ? 'die Tickets' : 'dein Ticket'} mit QR-Code in einer separaten Mail zugeschickt.`;

  return `WINTER BALL — Anmeldung eingegangen

${greetingLine}

${introText}${othersLine}
${payText}

Website: https://winterball27.de

30. Januar 2027 · 17:30 Uhr

${signoffText(plural, formal)}
${wrongRecipientText(formal)}`;
}

// ---------- Ticket-Mail (nach Bezahlung) ----------

function buildTicketCardHtml({ name, ticketId }) {
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=20&color=10-14-26&bgcolor=242-245-250&data=${encodeURIComponent(ticketId)}`;
  return `
    <div style="background:#ffffff;border-radius:16px;padding:22px;text-align:center;margin-bottom:16px;">
      <img src="${qrUrl}" width="180" height="180" alt="QR Code" style="display:block;margin:0 auto 14px;border-radius:8px;">
      <div style="color:#0a0e1a;font-size:17px;font-weight:600;">${escapeHtml(name)}</div>
      <div style="color:#8a93a8;font-size:11px;margin-top:10px;letter-spacing:1px;">TICKET-ID: ${escapeHtml(ticketId)}</div>
    </div>`;
}

async function buildOrderEmailHtml({ ordererName, attendees, formal, greeting }, env) {
  const cards = attendees.map(a => buildTicketCardHtml(a)).join('');
  const plural = attendees.length > 1;

  const headerTitle = formal
    ? (plural ? `${attendees.length} Tickets` : 'Ihr Ticket')
    : (plural ? `${attendees.length} Tickets` : 'Dein Ticket');

  const greetingLine = greeting
    ? escapeHtml(greeting)
    : (formal ? `Guten Tag ${escapeHtml(ordererName)},` : `Hallo ${escapeHtml(ordererName)},`);

  const forPersonText = formal ? 'Sie' : 'dich';
  const receiptText = formal ? 'Ihre Quittung liegt' : (plural ? 'Eure Quittung liegt' : 'Deine Quittung liegt');

  return `
  <div style="background:#0a0e1a;padding:40px 16px;font-family:'Segoe UI',system-ui,sans-serif;">
    <div style="max-width:420px;margin:0 auto;background:linear-gradient(180deg,#131c30,#1c2a45);border-radius:20px;overflow:hidden;border:1px solid rgba(255,255,255,0.1);">
      <div style="padding:36px 28px 20px;text-align:center;">
        <div style="color:#eef2fb;font-size:13px;letter-spacing:2px;text-transform:uppercase;opacity:0.6;margin-bottom:4px;">${headerTitle}</div>
        <div>
          <a href="https://winterball27.de" target="_blank" rel="noopener noreferrer" style="color:#ffffff;text-decoration:none;font-size:30px;font-style:italic;font-family:Georgia,serif;">Winter Ball</a>
        </div>
        <div style="color:#eef2fb;font-size:16px;margin-top:14px;">${greetingLine}</div>
      </div>
      <div style="padding:8px 20px 0;">${cards}</div>
      <div style="padding:16px 28px 32px;text-align:center;color:#9aa7c2;font-size:13px;line-height:1.7;">
        <div style="color:#eef2fb;font-size:15px;margin-bottom:6px;">30. Januar 2027 · 17:30 Uhr</div>
        Bitte den passenden QR-Code am Einlass für ${plural ? 'jede Person' : forPersonText} bereithalten (auch als PDF im Anhang).<br>
        ${receiptText} ebenfalls als PDF bei.
        
        <!-- Button zur Website -->
        <div style="margin:24px 0 16px;text-align:center;">
          <a href="https://winterball27.de" target="_blank" rel="noopener noreferrer" 
             style="background:#8fb4ff;background:linear-gradient(135deg,#8fb4ff,#c2d8ff);color:#0a0e1a;padding:13px 30px;border-radius:100px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block;letter-spacing:0.3px;box-shadow:0 6px 20px rgba(143,180,255,0.35);">
            winterball27.de besuchen &rarr;
          </a>
        </div>

        ${noCancelHtml(plural, formal)}
        ${signoffHtml(plural, formal)}
        ${wrongRecipientHtml(formal)}
      </div>
    </div>
  </div>`;
}

function buildOrderEmailText({ ordererName, attendees, formal, greeting }) {
  const plural = attendees.length > 1;
  const list = attendees.map(a => `- ${a.name} (Ticket-ID: ${a.ticketId})`).join('\n');

  const title = formal
    ? (plural ? `${attendees.length} Tickets` : 'Ihr Ticket')
    : (plural ? `${attendees.length} Tickets` : 'Dein Ticket');

  const greetingLine = greeting
    ? greeting
    : (formal ? `Guten Tag ${ordererName},` : `Hallo ${ordererName},`);

  const ticketsText = formal
    ? (plural ? 'Ihre Tickets' : 'Ihr Ticket')
    : (plural ? 'Eure Tickets' : 'Dein Ticket');

  const forPersonText = formal ? 'Sie' : 'dich';
  const receiptText = formal ? 'Ihre Quittung liegt' : (plural ? 'Eure Quittung liegt' : 'Deine Quittung liegt');

  return `WINTER BALL — ${title}

${greetingLine}

${list}

${ticketsText} mit QR-Code ${plural ? 'liegen' : 'liegt'} dieser Mail als PDF bei. Bitte den passenden Code
am Einlass für ${plural ? 'jede Person' : forPersonText} bereithalten. ${receiptText} ebenfalls als PDF bei.

Website: https://winterball27.de

30. Januar 2027 · 17:30 Uhr
${noCancelText(plural, formal)}
${signoffText(plural, formal)}
${wrongRecipientText(formal)}`;
}

// ---------- Router ----------

export default {
  async fetch(request, env) {
    currentOrigin = request.headers.get("Origin");

    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });

    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/wallet-logo.png") {
      return new Response(base64ToUint8Array(WALLET_LOGO_PNG_BASE64), {
        headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" },
      });
    }
    if (request.method === "GET" && url.pathname === "/wallet-hero.jpg") {
      return new Response(base64ToUint8Array(WALLET_HERO_JPG_BASE64), {
        headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" },
      });
    }

    if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders() });

    // 1. ANMELDE-BESTÄTIGUNG
    if (url.pathname === "/send-confirmation") {
      try {
        const payload = await request.json();
        const { name, email, attendeeNames, useLernSax, greeting } = payload;
        if (!name || !email || !Array.isArray(attendeeNames)) return json({ error: "Fehlende Felder" }, 400);

        const formal = isFormalSalutation(payload);
        const subject = "✨ Anmeldung zum Winter Ball eingegangen ✨";
        const html = buildConfirmationEmailHtml({ name, attendeeNames, formal, greeting });
        const text = buildConfirmationEmailText({ name, attendeeNames, formal, greeting });

        if (useLernSax) {
          try {
            await sendViaLernSax(env, { to: email, subject, text, html, attachments: [] });
            return json({ success: true, via: "lernsax" });
          } catch (smtpErr) {
            console.error("LernSax-Versand fehlgeschlagen, weiche auf Brevo aus:", smtpErr);
          }
        }

        const sender = parseSender(env.SENDER_EMAIL);
        const brevoRes = await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: { "api-key": env.BREVO_API_KEY, "Content-Type": "application/json", "Accept": "application/json" },
          body: JSON.stringify({
            sender,
            to: [{ email }],
            subject,
            htmlContent: html,
            textContent: text,
          }),
        });

        if (!brevoRes.ok) {
          const errMsg = await describeBrevoError(brevoRes);
          return json({ error: errMsg }, 502);
        }
        return json({ success: true, via: "brevo" });
      } catch (err) {
        console.error(err);
        return json({ error: "Serverfehler" }, 500);
      }
    }

    // 2. TICKETS-PDF DOWNLOAD
    if (url.pathname === "/generate-pdf") {
      try {
        await requireAdmin(request);
        const { attendees } = await request.json();
        if (!Array.isArray(attendees) || attendees.length === 0) {
          return json({ error: "Fehlende Felder" }, 400);
        }
        const pdfBytes = await buildTicketsPdf(attendees);
        return new Response(pdfBytes, {
          status: 200,
          headers: {
            ...corsHeaders(),
            "Content-Type": "application/pdf",
            "Content-Disposition": 'attachment; filename="Winterball-Tickets.pdf"',
          },
        });
      } catch (err) {
        console.error(err);
        const status = err.message.includes("Token") || err.message.includes("Login") ? 401 : 500;
        return json({ error: status === 401 ? "Nicht eingeloggt" : "PDF-Erstellung fehlgeschlagen" }, status);
      }
    }

    // 3. QUITTUNG-PDF DOWNLOAD
    if (url.pathname === "/generate-invoice") {
      try {
        await requireAdmin(request);
        const { ordererName, attendees } = await request.json();
        if (!ordererName || !Array.isArray(attendees) || attendees.length === 0) {
          return json({ error: "Fehlende Felder" }, 400);
        }
        const invoiceBytes = await buildInvoicePdf({ ordererName, attendees });
        return new Response(invoiceBytes, {
          status: 200,
          headers: {
            ...corsHeaders(),
            "Content-Type": "application/pdf",
            "Content-Disposition": 'attachment; filename="Winterball-Quittung.pdf"',
          },
        });
      } catch (err) {
        console.error(err);
        const status = err.message.includes("Token") || err.message.includes("Login") ? 401 : 500;
        return json({ error: status === 401 ? "Nicht eingeloggt" : "Quittung konnte nicht erstellt werden" }, status);
      }
    }

    // 4. TICKET-MAIL VERSAND (NACH BEZAHLUNG)
    if (url.pathname === "/send-tickets") {
      try {
        await requireAdmin(request);
        const payload = await request.json();
        const { email, ordererName, attendees, useLernSax, greeting } = payload;
        if (!email || !ordererName || !Array.isArray(attendees) || attendees.length === 0) {
          return json({ error: "Fehlende Felder" }, 400);
        }

        const formal = isFormalSalutation(payload);
        const plural = attendees.length > 1;

        const pdfBytes = await buildTicketsPdf(attendees);
        const pdfBase64 = uint8ToBase64(pdfBytes);
        const invoiceBytes = await buildInvoicePdf({ ordererName, attendees });
        const invoiceBase64 = uint8ToBase64(invoiceBytes);

        const subject = formal
          ? (plural ? `✨ Ihre ${attendees.length} Tickets für den Winter Ball ✨` : "✨ Ihr Ticket für den Winter Ball ✨")
          : (plural ? `✨ Eure ${attendees.length} Tickets für den Winter Ball ✨` : "✨ Dein Ticket für den Winter Ball ✨");

        const html = await buildOrderEmailHtml({ ordererName, attendees, formal, greeting }, env);
        const text = buildOrderEmailText({ ordererName, attendees, formal, greeting });
        const attachments = [
          { filename: "Winterball-Tickets.pdf", content: pdfBase64 },
          { filename: "Winterball-Quittung.pdf", content: invoiceBase64 },
        ];

        if (useLernSax) {
          try {
            await sendViaLernSax(env, { to: email, subject, text, html, attachments });
            return json({ success: true, via: "lernsax" });
          } catch (smtpErr) {
            console.error("LernSax-Versand fehlgeschlagen, weiche auf Brevo aus:", smtpErr);
          }
        }

        const sender = parseSender(env.SENDER_EMAIL);
        const brevoRes = await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: { "api-key": env.BREVO_API_KEY, "Content-Type": "application/json", "Accept": "application/json" },
          body: JSON.stringify({
            sender,
            to: [{ email }],
            subject,
            htmlContent: html,
            textContent: text,
            attachment: attachments.map(a => ({ name: a.filename, content: a.content })),
          }),
        });

        if (!brevoRes.ok) {
          const errMsg = await describeBrevoError(brevoRes);
          return json({ error: errMsg }, 502);
        }
        return json({ success: true, via: "brevo" });
      } catch (err) {
        console.error(err);
        const status = err.message.includes("Token") || err.message.includes("Login") ? 401 : 500;
        return json({ error: status === 401 ? "Nicht eingeloggt" : "Serverfehler: " + (err.message || "") }, status);
      }
    }

    return new Response("Not found", { status: 404, headers: corsHeaders() });
  },
};