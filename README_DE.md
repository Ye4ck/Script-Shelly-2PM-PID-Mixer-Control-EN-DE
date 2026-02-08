# Shelly 2PM PID Mischer-Steuerung

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Shelly Gen2+](https://img.shields.io/badge/Shelly-Gen2+-blue.svg)](https://www.shelly.com/)

Eine intelligente PID-Regelung für Heizungsmischer basierend auf dem Shelly 2PM mit integrierter Notfall-Funktion zum Schutz des Pufferspeichers.

[🇬🇧 English Version](README.md)

## 🔐 Sicherheitshinweise

⚠️ **WICHTIG**:
- Dieses Script steuert deine Heizungsanlage
- Teste gründlich in einer sicheren Umgebung
- Überwache das System in den ersten Tagen intensiv
- Stelle sicher, dass Notfall-Abschaltungen funktionieren
- Bei Unsicherheit: Konsultiere einen Fachmann

## 📋 Inhaltsverzeichnis

- [Features](#-features)
- [Systemanforderungen](#-systemanforderungen)
- [Installation](#-installation)
- [Konfiguration](#️-konfiguration)
- [Funktionsweise](#-funktionsweise)
- [Notfall-Modus](#-notfall-modus)
- [PID-Parameter Tuning](#-pid-parameter-tuning)
- [Fehlerbehebung](#-fehlerbehebung)
- [Lizenz](#-lizenz)

## ✨ Features

- **🎯 PID-Regelung**: Präzise Temperaturregelung mit anpassbaren Parametern (Kp, Ki, Kd)
- **🚨 Notfall-Schutz**: Automatisches Schließen des Mischers bei zu niedriger Pufferspeicher-Temperatur
- **📊 Zustandsüberwachung**: Echtzeit-Status-Anzeige über virtuelle Textkomponente
- **⏱️ Intelligente Timer**: Optimierte Abfrageintervalle zur Schonung der Hardware
- **🔒 Anti-Windup**: Verhindert Integral-Überlauf bei langen Regelabweichungen
- **📝 Detailliertes Logging**: Umfangreiche Debug-Ausgaben für Fehlersuche
- **🛡️ Fehlertoleranz**: Robuste Fehlerbehandlung bei Sensor-Ausfällen

## 🔧 Systemanforderungen

### Hardware
- **Shelly 2PM** (Gen2 oder Gen2+)
- **2x DS18B20 Temperatursensoren** (oder kompatibel)
  - Sensor 100: Pufferspeicher-Fühler
  - Sensor 101: Vorlauf-Temperaturfühler
- **Mischer-Motor** (0-100% in 120 Sekunden)

### Software
- Shelly Firmware Gen2+ mit JavaScript-Support
- Virtuelle Komponenten aktiviert

## 📥 Installation

### Schritt 1: Virtuelle Komponenten einrichten

Erstelle folgende virtuelle Komponenten in deinem Shelly 2PM:

| Typ | ID | Name | Standardwert | Beschreibung |
|-----|-----|------|--------------|--------------|
| Number | 200 | Sollwert | 25 | Ziel-Temperatur in °C |
| Number | 201 | PID Kp | 6.0 | Proportional-Faktor |
| Number | 202 | PID Ki | 0.03 | Integral-Faktor |
| Number | 203 | PID Kd | 2.0 | Differential-Faktor |
| Text | 200 | Status | AUTO | Betriebszustand |

### Schritt 2: Temperatursensoren zuweisen

Stelle sicher, dass die Temperatursensoren korrekt angeschlossen und zugeordnet sind:
- **Sensor ID 100**: Pufferspeicher
- **Sensor ID 101**: Vorlauftemperatur

### Schritt 3: Script hochladen

1. Öffne die Shelly Web-Oberfläche
2. Navigiere zu **Scripts** → **Library**
3. Erstelle ein neues Script
4. Kopiere den Inhalt von `shelly_2pm_pid_mischer.js`
5. Speichern und **Script aktivieren**

### Schritt 4: Konfiguration anpassen

Passe die Konfigurationswerte am Anfang des Scripts an deine Anlage an:

```javascript
/*********** KONFIGURATION ***********/
let COVER_ID = 0;                    // Deine Shelly Cover ID
let TEMP_SENSOR_ID = 101;            // Vorlauf-Sensor
let BUFFER_SENSOR_ID = 100;          // Puffer-Sensor

// Mischer-Laufzeit anpassen (Sekunden für 0-100%)
let MIXER_FULL_TIME = 120;

// Notfall-Schwellwerte
let BUFFER_EMERGENCY_MIN = 40;       // Unter 40°C -> Notfall
let BUFFER_EMERGENCY_OK = 45;        // Über 45°C -> Normal
```

## ⚙️ Konfiguration

### Mischer-Kalibrierung

Bestimme die Laufzeit deines Mischers von 0% auf 100%:

1. Schließe den Mischer vollständig (manuell)
2. Messe die Zeit bis zur vollständigen Öffnung
3. Trage den Wert in `MIXER_FULL_TIME` ein (in Sekunden)

**Beispiel**: Dein Mischer benötigt 2 Minuten für die volle Fahrt → `MIXER_FULL_TIME = 120`

### Timer-Intervalle

Die Standard-Timer sind für die meisten Anwendungen optimiert:

```javascript
let TEMP_READ_INTERVAL = 10000;      // 10 Sekunden - Temperatur-Abfrage
let PID_CALC_INTERVAL = 150000;      // 2,5 Minuten - PID-Berechnung
let BUFFER_CHECK_INTERVAL = 30000;   // 30 Sekunden - Puffer-Check
let MIN_MOVE_PAUSE = 30000;          // 30 Sekunden - Pause zwischen Fahrten
```

**Empfehlungen**:
- **Träges System** (große Wassermenge): Intervalle verlängern
- **Schnelles System** (kleine Rohrleitungen): Intervalle verkürzen
- **Kritischer Puffer**: `BUFFER_CHECK_INTERVAL` reduzieren

## 🔄 Funktionsweise

### PID-Regelkreis

```
Sollwert - Ist-Temperatur = Fehler (Error)
         ↓
    ┌────────────────┐
    │  P: Kp × Error │
    │  I: Ki × ∫Error│
    │  D: Kd × dError│
    └────────────────┘
         ↓
   Output (±15% max)
         ↓
   Mischer-Position
```

### Regelzyklus (alle 2,5 Minuten)

1. **Temperatur lesen**: Aktuelle Vorlauftemperatur abrufen
2. **Fehler berechnen**: `error = setpoint - flowTemp`
3. **PID berechnen**: P, I und D Terme kombinieren
4. **Position berechnen**: Neue Mischer-Position ermitteln
5. **Mischer bewegen**: Falls nötig, Position anfahren

### Zustandsautomaten

```
AUTO ←→ MOVING → AUTO
  ↓         ↓
EMERGENCY   PAUSE
  ↓         ↓
AUTO ←→  ERROR
```

| Zustand | Beschreibung |
|---------|--------------|
| **AUTO** | Normaler PID-Betrieb |
| **MOVING** | Mischer fährt gerade |
| **PAUSE** | Wartezeit zwischen Bewegungen |
| **EMERGENCY** | Notfall-Modus aktiv |
| **ERROR** | Fehler aufgetreten |

## 🚨 Notfall-Modus

### Aktivierung

Der Notfall-Modus wird aktiviert, wenn:
- Pufferspeicher-Temperatur **< 40°C** fällt

**Automatische Aktionen**:
1. ⚠️ Status wechselt zu "EMERGENCY"
2. 🔒 PID-Regelung wird deaktiviert
3. ⬇️ Mischer fährt sofort auf **0%** (geschlossen)
4. ⏸️ Normale Regelung pausiert

### Deaktivierung

Der Notfall-Modus wird beendet, wenn:
- Pufferspeicher-Temperatur **≥ 45°C** erreicht

**Automatische Aktionen**:
1. ✅ Status wechselt zurück zu "AUTO"
2. 🔄 PID-Regelung wird neu initialisiert
3. ▶️ Normale Regelung läuft wieder an

### Hysterse-Effekt

Die **5°C Hysterese** (40°C bis 45°C) verhindert ständiges Ein/Ausschalten bei Temperaturschwankungen.

```
Temperatur
   │
45°├─────────────  ← Notfall AUS
   │   Normal
   │   Betrieb
40°├─────────────  ← Notfall AN
   │   Notfall
   │   Mischer ZU
   └──────────────> Zeit
```

## 🎛️ PID-Parameter Tuning

### Methode 1: Ziegler-Nichols (Einfach)

1. Setze Ki = 0, Kd = 0
2. Erhöhe Kp bis System oszilliert
3. Nutze folgende Werte:
   - Kp = 0.6 × Kp_kritisch
   - Ki = 1.2 × Kp / T_oszillation
   - Kd = 0.075 × Kp × T_oszillation

### Methode 2: Manuelles Tuning

#### Schritt 1: P-Anteil (Kp)
- **Start**: Kp = 5.0
- **Zu träge**: Erhöhe Kp (z.B. +1.0)
- **Überschwinger**: Reduziere Kp (z.B. -0.5)
- **Ziel**: Schnelle Reaktion ohne starkes Überschwingen

#### Schritt 2: I-Anteil (Ki)
- **Start**: Ki = 0.03
- **Bleibende Abweichung**: Erhöhe Ki (z.B. +0.01)
- **Instabil**: Reduziere Ki (z.B. -0.01)
- **Ziel**: Kein Offset, stabile Regelung

#### Schritt 3: D-Anteil (Kd)
- **Start**: Kd = 2.0
- **Überschwinger**: Erhöhe Kd (z.B. +0.5)
- **Rauschempfindlich**: Reduziere Kd (z.B. -0.5)
- **Ziel**: Gedämpfte Reaktion auf schnelle Änderungen

### Empfohlene Startwerte

| Anlagentyp | Kp | Ki | Kd |
|------------|-----|-----|-----|
| **Fußbodenheizung** (träge) | 3.0 | 0.01 | 1.0 |
| **Radiator** (mittel) | 6.0 | 0.03 | 2.0 |
| **Konvektor** (schnell) | 10.0 | 0.05 | 3.0 |

### Testprozedur

1. Ändere Parameter über virtuelle Komponenten
2. Beobachte das Verhalten über 1-2 Stunden
3. Prüfe Log-Ausgaben für Details
4. Iteriere bis optimales Verhalten erreicht

**Tipp**: Ändere immer nur **einen** Parameter auf einmal!

## 🐛 Fehlerbehebung

### Problem: Mischer bewegt sich nicht

**Mögliche Ursachen**:
- ✅ Prüfe `COVER_ID` - ist die ID korrekt?
- ✅ Prüfe Verkabelung des Mischers
- ✅ Prüfe Shelly 2PM Cover-Konfiguration
- ✅ Prüfe Log: "Error starting movement"

**Lösung**:
```javascript
// Im Log sollte erscheinen:
"Moving mixer: 50% -> 55% (6s)"
```

### Problem: Keine Temperatur-Werte

**Mögliche Ursachen**:
- ✅ Sensor-IDs falsch konfiguriert
- ✅ Sensoren nicht angeschlossen
- ✅ Sensoren defekt

**Lösung**:
```javascript
// Prüfe Sensor-IDs in der Shelly Web-Oberfläche
// Temperatur-Komponenten → ID notieren
```

### Problem: Ständiger Notfall-Modus

**Mögliche Ursachen**:
- ✅ Puffer tatsächlich zu kalt
- ✅ `BUFFER_EMERGENCY_MIN` zu hoch gesetzt
- ✅ Falscher Sensor als Puffer konfiguriert

**Lösung**:
```javascript
// Passe Schwellwerte an:
let BUFFER_EMERGENCY_MIN = 35;  // Niedriger
let BUFFER_EMERGENCY_OK = 40;   // Niedriger
```

### Problem: System oszilliert

**Symptom**: Mischer fährt ständig hin und her

**Ursache**: PID-Parameter zu aggressiv

**Lösung**:
1. Reduziere Kp um 50%
2. Reduziere Ki um 50%
3. Erhöhe Kd um 50%
4. Teste und iteriere

### Problem: System reagiert zu langsam

**Symptom**: Temperatur erreicht Sollwert nie

**Ursache**: PID-Parameter zu konservativ

**Lösung**:
1. Erhöhe Kp um 20%
2. Erhöhe Ki um 20%
3. Teste und iteriere

## 📊 Logging und Monitoring

### Log-Ausgaben interpretieren

```javascript
// Normale PID-Ausgabe:
"PID: Actual=42.5°C, Setpoint=45°C, Error=2.50°C, Output=5.23%, New=55.2%, P=15.00 I=-8.50 D=-1.27"
```

**Bedeutung**:
- `Actual`: Gemessene Temperatur
- `Setpoint`: Ziel-Temperatur
- `Error`: Differenz (positiv = zu kalt)
- `Output`: Änderung der Mischer-Position
- `P/I/D`: Einzelne Terme der Regelung

### Kritische Log-Meldungen

| Meldung | Bedeutung | Aktion |
|---------|-----------|--------|
| `!!! EMERGENCY ACTIVATED !!!` | Notfall aktiv | Prüfe Puffer-Heizung |
| `Error reading sensor` | Sensor-Fehler | Prüfe Verkabelung |
| `Invalid time difference` | Timer-Problem | Script neu starten |
| `Position already reached` | Kein Bedarf | Normal, keine Aktion |

## 📄 Lizenz

Dieses Projekt ist unter der MIT-Lizenz lizenziert - siehe [LICENSE](LICENSE) für Details.
