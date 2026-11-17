# Widget-Prototyp: GI-Veranstaltungskarte

Ein inofficieller Prototyp, der kommende Veranstaltungen der Gesellschaft für Informatik e.V. (GI) auf einer Deutschlandkarte zeigt. 

Live: https://marcoheinisch.github.io/gi-eventmap-prototype/

## Wie es funktioniert

- `index.html` ist das Widget: eine Datei, Inline-SVG, kein externes JavaScript. Es lädt `events.json`.
- `update-events.js` liest die öffentliche Veranstaltungsliste (Zeitraum: nächste sechs Monate) und
  schreibt `events.json`. Übernommen werden nur Titel, Link, Datum, Kategorie-Tags und Ort.
  Keine Beschreibungen, keine Bilder.
- Orte werden einmalig über Nominatim (OpenStreetMap) in Koordinaten übersetzt und in
  `.geocode-cache.json` gespeichert. Diese Datei enthält nur Stadtnamen und Koordinaten.
- Ein GitHub-Actions-Workflow läuft zweimal pro Woche (Mo und Do), erzeugt `events.json` neu und veröffentlicht
  `index.html` plus `events.json` über GitHub Pages. `events.json` wird nicht ins Repository
  committet; es existiert nur auf der veröffentlichten Seite.

## Datenquelle und Zugriff

- Veranstaltungsdaten stammen von [gi.de/aktuelles/veranstaltungen](https://gi.de/aktuelles/veranstaltungen) und verlinken dorthin.
- Rund 15 HTTP-Anfragen pro Lauf, zwei Läufe pro Woche (etwa 8-9 im Monat), 500 ms Pause zwischen
  Anfragen. Bei 5xx höchstens zwei Wiederholungen (nach 10 s und 30 s), danach bricht der Lauf ab.
- Der Client identifiziert sich mit einem User-Agent, der auf dieses Repository verweist.
- `robots.txt` von gi.de erlaubt den Zugriff auf die Veranstaltungsseiten.
- Die Veranstaltungsdaten gehören der GI. Sie werden hier nur für diesen Prototyp aufbereitet;


## Lokal ausführen

```bash
cp events.json.example events.json   # oder: npm run update (holt echte Daten)
python3 -m http.server 8080
```

Dann `http://localhost:8080/index.html` öffnen. `?layout=page` zeigt das Seitenlayout.

