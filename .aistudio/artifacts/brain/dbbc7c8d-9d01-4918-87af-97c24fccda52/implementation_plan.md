# Implementierungsplan: Vollständige Überarbeitung und Ausbau des Insights-Tabs (admin.html)

## Status: Abgeschlossen (Completed)

### 1. Zentralisierung & Harmonisierung der Finanzmetriken (`calculateRevenueStats()`)
- [x] Zentrale Hilfsfunktion `calculateRevenueStats()` eingeführt.
- [x] Oberste KPI-Kacheln, Prognose-Widget und Demografie centgenau synchronisiert.

### 2. Detaillierter Klassen- & Stufen-Breakdown (`getGuestClassBreakdown()`)
- [x] Intelligente Klassenstufenzuordnung mit Rangliste und Balkendiagramm.

### 3. Reale Daten für Stoßzeiten (`peakTimes`)
- [x] 24h-Kurve aus realen Buchungs- bzw. Webseitenaufrufen mit Metrik-Umschalter.

### 4. Vollständiger Ausbau des Conversion-Funnels (`getFunnelMetrics()`)
- [x] **Widget-Card erweitert**:
  - Segmentierter Sub-Tab Umschalter: `[Formular]`, `[Kasse & Einlass]`, `[End-to-End]` direkt im Dashboard ohne Neuladen.
  - Dynamische Balken, Raten und Engpassanzeigen je nach Modus.
- [x] **Detail-Modal zur Conversion-Intelligence Suite ausgebaut**:
  - **Tab 1: 🌐 Formular-Trichter**: 7 granulare Schritte vom Startseitenbesuch über Name, E-Mail, Begleitung bis zur fertigen Reservierung inkl. Monotonie-Glättung und relativer Drop-off Analyse.
  - **Tab 2: 🎟️ End-to-End Lifecycle**: Nahtlose Betrachtung von erstem Website-Besucher bis zum eingecheckten Ballgast mit quantifizierten Verlusten in Personen und Euro.
  - **Tab 3: 💳 Kassen- & Einlassstatus**: Fokus auf bezahlte vs. unbezahlte Tickets, U18- vs. Ü18-Bezahlquoten und tatsächliche Check-in Quote am Einlass.
  - **Tab 4: 📱 Mobile vs. Desktop**: Vergleich der Conversion und Abbruchraten zwischen Smartphones und Computern mit Touch-Optimierungsempfehlungen.
  - **Zeitraum-Filter**: Umschalter für `Gesamt`, `Letzte 7 Tage` und `Letzte 24 Stunden`.
  - **Action-Box**: 
    - 1-Klick-Sprung zur Gästeliste mit Vorfilter auf `unpaid` (`filterUnpaidFromFunnel()`).
    - 1-Klick-Kopierfunktion für freundliche Zahlungserinnerungen für WhatsApp & Mail (`copyPaymentReminderText()`).
    - Automatische Conversion-Tipps basierend auf dem aktuell größten Engpass.
