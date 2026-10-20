# Voraussichtlicher Umsatz & Intuitive Kassen-Oberfläche (POS)

Strukturierte Zusammenfassung und Umsetzungsplan für die neuen Kassen- und Umsatzfunktionen im Admin-Bereich des Winterballs 2027.

## User Review & Critical Decisions

> [!IMPORTANT]
> Bitte prüfe die nachfolgende Gliederung deiner Anforderungen. Wenn alles so wie gewünscht erfasst ist, bestätige den Plan einfach mit dem **Proceed**-Button (oder schreibe kurz dein Okay im Chat), damit die Umsetzung gestartet werden kann.

* **1. Voraussichtlicher Umsatz (Neue Kennzahl im Header):**
  * Zusätzliche KPI-Statistikkarte im Dashboard neben den bisherigen Einnahmen.
  * Zeigt den gesamten erwarteten Umsatz aller bisher reservierten und gültigen Tickets (Bezahlt + noch ausstehend).
* **2. Neue intuitive Kassen-Oberfläche (Tab „Kassieren“):**
  * **Keine initiale Liste:** Die Ansicht startet völlig aufgeräumt ohne verwirrende Tabellenberge.
  * **Großes zentrales Suchfeld:** Schnelle Suche nach Bestellername, Begleitperson, E-Mail, Klasse oder Ticket-Code. Erst bei passender Eingabe wird eine übersichtliche Karte mit den Details und dem fälligen Betrag eingeblendet.
  * **Bestellung anlegen:** Der Button `+ Neue Bestellung anlegen` (mit Schülerauswahl, U18/Ü18, Begleitungen und LernSax-Vorschlag) wandert hierher.
* **3. Sicherer Kassiervorgang mit Ziffernblock & „Passend“:**
  * Kein versehentliches 1-Klick-Bezahlen!
  * Durch Klick auf `Bezahlen` öffnet sich das Kassen-Modal mit interaktivem Ziffernblock (Gegeben, automatischer Rückgeldrechner) sowie der praktische Schnell-Button **`Passend`**.
  * Erst bei ausreichender Zahlung oder Auswahl von „Passend“ wird die Buchung im System vollzogen.
* **4. Bereinigung des bestehenden Tabs „Bestellungen“:**
  * Entfernen des Buttons `Bestellung anlegen` (Neuaufnahmen finden geordnet in der Kasse statt).
  * Entfernen der `Bezahlen`-Aktionsbuttons aus der Tabelle und den mobilen Karten – dort wird künftig **nur noch der reine Status** (`Bezahlt`, `Offen`, `Teilweise bezahlt`) informativ dargestellt.
* **5. Admin-Login Robustheit:**
  * Unterstützung der Enter-Taste für schnelles Einloggen und aussagekräftige Rückmeldung bei Fehlschlägen.

---

## 1. Overview & Core Concept

* **Was es tut:** Trennt die reine Verwaltungs- und Einsichtsliste („Bestellungen“) strikt vom aktiven Verkaufs- und Barzahlungsgeschehen („Kasse“). Das Team an der Kasse (z.B. im Schulfoyer während der großen Pausen) erhält eine fokussierte, fehlerresistente Kassen-Maske.
* **Zielgruppe:** Schülervertreter, Lehrkräfte und Kassenwarte des Winterball-Organisationsteams bei der Annahme von Bargeld.
* **Hauptnutzen:** Verhindert Fehlklicks und langes Suchen in Hunderten Tabellenzeilen; exakte Rückgeldberechnung; transparente Finanzkontrolle durch Gegenüberstellung von *bereits eingenommenem* und *voraussichtlich erwartetem* Umsatz.

---

## 2. User Experience & Visual Design

### Ablauf an der Kasse (Kassieren-Tab):
```
┌─────────────────────────────────────────────────────────────────┐
│                      💳 KASSE & VORVERKAUF                     │
│                                                                 │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │ 🔍 Name, Begleitung, E-Mail oder Ticket-ID suchen...    │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│              [ + Neue Bestellung an der Kasse anlegen ]         │
│                                                                 │
│   (Ruhezustand: Keine zeilenlange Tabelle sichtbar)             │
│                                                                 │
│   ─ Bei Suchtreffer erscheint eine kompakte Aktionskarte: ────── │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │ Max Mustermann · Kl. 10b (U18) + 1 Begleitung (Ü18)     │   │
│   │ Status: 2 Tickets unbezahlt · Fällig: 17,00 €           │   │
│   │                                                         │   │
│   │ [ 💳 Jetzt Bezahlen ]   [ 📄 Details / Begleitungen ]    │   │
│   └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                               │ (Klick auf Bezahlen)
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                     💵 Kassen-Zahlungsfenster                   │
│                                                                 │
│   Fälliger Betrag: 17,00 €                                      │
│   Gegeben:         20,00 €                                      │
│   Rückgeld:         3,00 €  (grün hervorgehoben)                │
│                                                                 │
│   ┌───────┬───────┬───────┐                                     │
│   │   1   │   2   │   3   │                                     │
│   │   4   │   5   │   6   │                                     │
│   │   7   │   8   │   9   │                                     │
│   │   C   │   0   │   ⌫   │                                     │
│   └───────┴───────┴───────┘                                     │
│                                                                 │
│                   [  ⭐ PASSEND (17,00 €)  ]                    │
│                                                                 │
│        [ Abbrechen ]              [ ✓ Zahlung bestätigen ]      │
└─────────────────────────────────────────────────────────────────┘
```

### Anpassung Tab „Bestellungen“:
* Die Toolbar enthält nur noch Suche, Statusfilter-Chips (Alle, Unbezahlt, Bezahlt, etc.) und den CSV-Export.
* Der Button `Bestellung anlegen` ist hier entfernt.
* In der Tabelle und Mobile-Karten zeigt die Spalte „Bezahlt“ ausschließlich statische Badges:
  * `✓ Bezahlt` (Grün)
  * `Offen (Betrag fällig)` (Gelb/Orange)
  * `1/2 bezahlt` (Teilweise)
  * PDF- und Quittungs-Downloads bleiben für bezahlte Tickets erhalten.

### KPI-Leiste im Header:
* Ergänzung der Kachel **„Voraussichtlicher Umsatz“**:
  * Berechnet als: `Summe aller Tickets (U18 × 8 € + Ü18 × 9 €)` aller gültigen Bestellungen.
  * Gegenübergestellt mit **„Umsatz (bereits bezahlt)“**.
  * Differenzbetrag zeigt auf einen Blick das noch einzutreibende Restpotenzial.

---

## 3. Key Product Decisions & Trade-Offs

* **Entkopplung Kasse vs. Liste:**
  * *Entscheidung:* Keine Endlosliste im Kassenmodus, sondern Eingabefokus.
  * *Vorteil:* Bei über 300 Gästen muss sich die Kassenkraft in der Pause nicht durch Zeilen scrollen, sondern tippt 2–3 Buchstaben ein und hat sofort das gesuchte Ticket vor sich.
* **Ziffernblock-Zwang beim Kassieren:**
  * *Entscheidung:* Unterdrückung von 1-Klick-Zahlungen.
  * *Vorteil:* Verhindert Kassenfehlbestände und Irrtümer. Die Kassenkraft sieht das Wechselgeld direkt auf dem Bildschirm und gibt den Betrag fehlerfrei heraus.

---

## 4. Technical Architecture & Data Strategy

```
  ┌───────────────────────────────────────────────────────────────┐
  │                        Firestore DB                           │
  │   registrations (Bestellungen)  /  tickets (Einzeltickets)     │
  └───────────────────────────────┬───────────────────────────────┘
                                  │ Realtime Listener
                                  ▼
  ┌───────────────────────────────────────────────────────────────┐
  │                    Admin State Controller                     │
  │  - Berechnet: statRevenue (bezahlt)                           │
  │  - Berechnet: statProjectedRevenue (Gesamtwert aller Tickets) │
  │  - Filtert & liefert Daten für Kasse & Bestellungs-Ansichten  │
  └──────────────────────┬─────────────────┬──────────────────────┘
                         │                 │
                         ▼                 ▼
          ┌────────────────────────┐  ┌────────────────────────┐
          │  Tab: Kasse (POS)      │  │  Tab: Bestellungen     │
          │  - Suchgesteuerte View │  │  - Reine Audit-Tabelle │
          │  - Formular: Neu       │  │  - Nur Statusanzeige   │
          │  - Modal: Numpad/Change│  │  - Keine Bezahl-Buttons│
          └────────────────────────┘  └────────────────────────┘
```

Sobald du dein Einverständnis gibst, werden diese Anpassungen direkt in `admin.html` sauber eingepflegt und getestet.
