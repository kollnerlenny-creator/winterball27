# Implementierungsplan: Vollständige Überarbeitung und Ausbau des Insights-Tabs (admin.html)

## Status: Abgeschlossen (Completed)

### 1. Zentralisierung & Harmonisierung der Finanzmetriken (`calculateRevenueStats()`)
- [x] Zentrale Hilfsfunktion `calculateRevenueStats()` eingeführt, die:
  - Tickets nach `t.paid` oder Parent-Registrierung `r.paid` prüft.
  - Dynamische Preise (`ticketPrices.u18` / `ticketPrices.ue18` bzw. `t.price`) exakt berücksichtigt.
  - Spenden (`r.donation`) separat und centgenau für bezahlte sowie noch offene Registrierungen ermittelt.
  - Gesamtsummen auf den Cent genau errechnet: `actualTickets`, `actualDonations`, `actualTotal`, `pendingTotal`, `potentialTotal`.
- [x] Überall synchronisiert:
  - Oberste KPI-Kachel `statRevenue` & `statProjectedRevenue`
  - Widget "Finanz- & Ticketprognose" (Kachel + Detailmodal)
  - Widget "U18 / Ü18 Demografie" (Spendenkachel + Modal-Einnahmenverteilung)
  - Pricing-Listener aktualisiert bei Preisänderungen sofort die Charts via `scheduleCharts()`.

### 2. Neuer Klassen- & Stufen-Breakdown im Demografie-Modal (`getGuestClassBreakdown()`)
- [x] Intelligente Zuordnung von Gästen zu Klassen/Stufen:
  - Liest `t.schoolClass` / `r.schoolClass` aus oder extrahiert die Stufe aus LernSax-E-Mails (`s...` oder `jahrgang...`).
  - Stellt Nicht-Schüler / Externe sauber als "Gäste / Externe" dar.
- [x] Vollständige Visualisierung im Demografie-Modal:
  - Horizontales Balkendiagramm mit Teilnehmerzahlen je Klasse
  - Detaillierte Tabelle mit Rang, Klasse/Stufe, Gästezahl, U18/Ü18-Verteilung und Prozentanteil.

### 3. Echte Daten & Toggle im Stoßzeiten-Widget (`peakTimes`)
- [x] Fallback-Dummy-Zahlen entfernt:
  - Widget aggregiert nun primär echte Buchungszeitpunkte (`allTickets.createdAt` / `allRegs.createdAt`).
  - Wenn `allPageviews` vorhanden sind, steht im Modal ein interaktiver Toggle (`window.switchPeakTimeMetric('tickets')` vs `'pageviews'`) zur Verfügung.
  - Bei noch geringer Datenbasis wird ein klarer Hinweis und der aktuelle Buchungsschwerpunkt angezeigt.

### 4. Bereinigung & Ausbau des Konversionstrichters (`conversionFunnel`)
- [x] Robuste Fallback-Logik implementiert:
  - Wenn noch keine Pageview-Events getrackt wurden, wird nicht mehr fälschlicherweise ein 0%-Absturz dargestellt, sondern die tatsächlichen Registrierungsphasen (Gestartet -> Bezahlt -> Eingecheckt) als zuverlässige Konversionskette.
  - Im Modal wird eine Engpass-Analyse (Bottleneck) mit Optimierungsempfehlungen angezeigt.

### 5. Intelligente Prognose & Catering-Empfehlungen (`getForecastMetrics()`)
- [x] Verkaufsgeschwindigkeit (Tickets/Tag) wird auf Basis der tatsächlichen Ticket-Buchungstage errechnet (nicht verwässert durch Website-Traffic-Tage).
- [x] Hochrechnung des Ausverkaufsdatums (`projectedSellOutDate`) relativ zur eingestellten Hallenkapazität.
- [x] Catering- & Ressourcen-Planung im Modal:
  - Empfohlene Mindestmengen für Begrüßungsgetränke, U18-Softdrinks und Ü18-Getränkevorrat basierend auf der aktuellen Altersverteilung.
