# Implementierungsplan: Wartungsmodus (Maintenance Mode)

## Status: Abgeschlossen (Completed)

### 1. Firestore-Sicherheitsregeln (`firestore.rules`)
- [x] `docId == 'maintenance'` in den öffentlichen `settings`-Lesezugriff aufgenommen, damit unauthentifizierte Besucher den Status in Echtzeit abrufen können.

### 2. Admin-Verwaltung (`admin.html`)
- [x] **Einstellungen-Bereich**: Neuer Abschnitt *„Wartungsmodus (Website & Anmeldung pausieren)“* mit:
  - Live-Status-Badge (`● Website ist LIVE` vs. `● Wartungsmodus AKTIV`).
  - Ein/Aus-Schalter mit Bestätigungsabfrage (`Wartungsmodus aktivieren` / `Wartungsmodus beenden (Live schalten)`).
  - Textarea für optionale individuelle Besuchernachrichten.
  - Zeitstempel der letzten Änderung.
- [x] **Globales Warn-Banner**: Prominenter, sticky gelb-oranger Warnstreifen am oberen Rand des Admin-Dashboards mit Schnell-Button *„Jetzt beenden (Live schalten) 🚀“*.
- [x] **Echtzeit-Synchronisation**: `onSnapshot` auf `settings/maintenance` sorgt für sofortige Aktualisierung auf allen offenen Admin-Geräten.

### 3. Öffentliche Besucher-Seiten (`index.html`, `anmeldung.html`, `vorabstimmung.html`)
- [x] `onSnapshot` auf `settings/maintenance` integriert.
- [x] Bei aktiver Wartung: Eleganter, vollflächiger Winterball-Gala-Wartungsbildschirm mit Schneeflocken-Emblem, Countdown-/Puls-Badge, Admin-Nachricht und Neuladen-Button.
- [x] Bei Deaktivierung: Bildschirm schließt sich in Echtzeit automatisch ohne Neuladen.
- [x] Formulare und Ticketbestellungen sind während der Wartung zuverlässig gesperrt.
