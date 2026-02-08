/*********** KONFIGURATION ***********/
// Hardware IDs
let COVER_ID = 0;                    // Shelly 2PM Cover / Rolladen ID
let TEMP_SENSOR_ID = 101;            // ID des Vorlauf-Temperatursensors
let BUFFER_SENSOR_ID = 100;          // ID des Pufferspeicher-Sensors

// Virtuelle Komponenten IDs
let SETPOINT_ID = "number:200";      // Sollwert Temperatur (Grad)
let PID_KP_ID = "number:201";        // PID Parameter Kp
let PID_KI_ID = "number:202";        // PID Parameter Ki
let PID_KD_ID = "number:203";        // PID Parameter Kd
let STATE_TEXT_ID = 200;             // Text-Komponente fuer Betriebszustand

// PID Standard-Parameter
let Kp = 6.0;
let Ki = 0.03;
let Kd = 2.0;

// Timing-Konfiguration (in Millisekunden)
let TEMP_READ_INTERVAL = 10000;      // Temperatur-Abfrage: 10 Sekunden
let PID_CALC_INTERVAL = 150000;      // PID-Berechnung: 2,5 Minuten
let BUFFER_CHECK_INTERVAL = 30000;   // Puffer-Check: 30 Sekunden
let MIN_MOVE_PAUSE = 30000;          // Minimale Pause zwischen Bewegungen: 30 Sekunden

// Mischer-Konfiguration
let MIXER_FULL_TIME = 120;           // Sekunden fuer 0-100% Fahrt
let MIN_POSITION = 0;                // Minimale Position (geschlossen)
let MAX_POSITION = 100;              // Maximale Position (offen)

// Notfall-Schwellwerte
let BUFFER_EMERGENCY_MIN = 40;       // Unter 40°C -> Notfall
let BUFFER_EMERGENCY_OK = 45;        // Ueber 45°C -> Notfall beendet

/*********** BETRIEBSZUSTAENDE ***********/
let STATE = {
    AUTO: "AUTO",
    EMERGENCY: "NOTFALL",
    MOVING: "FAHRT",
    PAUSE: "PAUSE",
    ERROR: "FEHLER"
};

/*********** GLOBALE VARIABLEN ***********/
let currentState = STATE.AUTO;
let previousState = STATE.AUTO;

// Temperatur-Daten
let vorlaufTemp = null;              // Aktuelle Vorlauftemperatur
let bufferTemp = null;               // Aktuelle Puffertemperatur
let setpoint = 25;                   // Sollwert-Temperatur

// Mischer-Zustand
let currentPosition = 50;            // Aktuelle Position (0-100%)
let targetPosition = 50;             // Ziel-Position
let isMoving = false;                // Bewegungs-Flag
let lastMoveTime = 0;                // Zeitstempel der letzten Bewegung

// PID-Variablen
let integral = 0;
let lastError = 0;
let lastPidTime = Date.now();
let pidInitialized = false;

// Notfall-Status
let emergencyActive = false;
let emergencyStartTime = 0;

/*********** HILFSFUNKTIONEN ***********/

/**
 * Begrenzt einen Wert zwischen min und max
 */
function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

/**
 * Aktuelle Zeit in Millisekunden
 */
function now() {
    return Date.now();
}

/**
 * Setzt den Betriebszustand und aktualisiert die Text-Komponente
 */
function setState(newState) {
    if (currentState !== newState) {
        previousState = currentState;
        currentState = newState;
        
        // Text-Komponente aktualisieren
        Shelly.call("Text.Set", { 
            id: STATE_TEXT_ID, 
            value: newState 
        }, function(result) {
            // Erfolg
        }, function(error_code, error_message) {
            print("Fehler beim Setzen des Status:", error_message);
        });
        
        print("Zustandswechsel:", previousState, "->", newState);
    }
}

/**
 * Loggt eine Nachricht mit Zeitstempel
 */
function log(message) {
    print("[" + new Date().toISOString() + "]", message);
}

/*********** SENSOR-FUNKTIONEN ***********/

/**
 * Liest die Vorlauf-Temperatur
 */
function readVorlaufTemp() {
    try {
        let status = Shelly.getComponentStatus('temperature', TEMP_SENSOR_ID);
        if (status && typeof status.tC === 'number') {
            vorlaufTemp = status.tC;
            return true;
        } else {
            log("Vorlauf-Sensor: Ungueltiger Wert");
            vorlaufTemp = null;
            return false;
        }
    } catch (e) {
        log("Fehler beim Lesen des Vorlauf-Sensors: " + e);
        vorlaufTemp = null;
        return false;
    }
}

/**
 * Liest die Pufferspeicher-Temperatur
 */
function readBufferTemp() {
    try {
        let status = Shelly.getComponentStatus('temperature', BUFFER_SENSOR_ID);
        if (status && typeof status.tC === 'number') {
            bufferTemp = status.tC;
            return true;
        } else {
            log("Puffer-Sensor: Ungueltiger Wert");
            bufferTemp = null;
            return false;
        }
    } catch (e) {
        log("Fehler beim Lesen des Puffer-Sensors: " + e);
        bufferTemp = null;
        return false;
    }
}

/**
 * Liest den Sollwert aus der virtuellen Komponente
 */
function readSetpoint() {
    try {
        let handle = Virtual.getHandle(SETPOINT_ID);
        if (handle !== undefined) {
            let value = handle.getValue();
            if (typeof value === 'number' && value > 0 && value < 100) {
                setpoint = value;
                return true;
            }
        }
        log("Sollwert ungueltig, verwende Standard: " + setpoint);
        return false;
    } catch (e) {
        log("Fehler beim Lesen des Sollwerts: " + e);
        return false;
    }
}

/**
 * Liest die PID-Parameter aus virtuellen Komponenten
 */
function readPIDParameters() {
    try {
        let handleKp = Virtual.getHandle(PID_KP_ID);
        let handleKi = Virtual.getHandle(PID_KI_ID);
        let handleKd = Virtual.getHandle(PID_KD_ID);
        
        if (handleKp !== undefined) {
            let value = handleKp.getValue();
            if (typeof value === 'number' && value >= 0) {
                Kp = value;
            }
        }
        
        if (handleKi !== undefined) {
            let value = handleKi.getValue();
            if (typeof value === 'number' && value >= 0) {
                Ki = value;
            }
        }
        
        if (handleKd !== undefined) {
            let value = handleKd.getValue();
            if (typeof value === 'number' && value >= 0) {
                Kd = value;
            }
        }
        
        log("PID-Parameter: Kp=" + Kp + ", Ki=" + Ki + ", Kd=" + Kd);
        return true;
    } catch (e) {
        log("Fehler beim Lesen der PID-Parameter: " + e);
        return false;
    }
}

/*********** MISCHER-STEUERUNG ***********/

/**
 * Stoppt die aktuelle Mischer-Bewegung
 */
function stopMixer() {
    Shelly.call("Cover.Stop", { id: COVER_ID }, function(result) {
        isMoving = false;
        log("Mischer gestoppt bei Position: " + currentPosition + "%");
    }, function(error_code, error_message) {
        log("Fehler beim Stoppen: " + error_message);
        isMoving = false;
    });
}

/**
 * Bewegt den Mischer zu einer Zielposition
 */
function moveMixerTo(newTargetPosition, forceMove) {
    // Standardwert fuer forceMove
    if (forceMove === undefined) {
        forceMove = false;
    }
    
    // Position begrenzen
    newTargetPosition = clamp(newTargetPosition, MIN_POSITION, MAX_POSITION);
    
    // Pruefen ob Bewegung bereits laeuft
    if (isMoving && !forceMove) {
        log("Mischer bewegt sich bereits - ignoriere Befehl");
        return false;
    }
    
    // Pruefen ob Pause eingehalten werden muss
    let timeSinceLastMove = now() - lastMoveTime;
    if (timeSinceLastMove < MIN_MOVE_PAUSE && !forceMove) {
        log("Mindest-Pause noch aktiv (" + Math.round((MIN_MOVE_PAUSE - timeSinceLastMove) / 1000) + "s)");
        setState(STATE.PAUSE);
        return false;
    }
    
    // Berechne Differenz
    let positionDiff = newTargetPosition - currentPosition;
    
    // Zu kleine Aenderung ignorieren
    if (Math.abs(positionDiff) < 1 && !forceMove) {
        log("Position bereits erreicht (" + currentPosition + "%)");
        return false;
    }
    
    // Bewegung starten
    targetPosition = newTargetPosition;
    isMoving = true;
    setState(STATE.MOVING);
    
    // Berechne Fahrzeit
    let movePercentage = Math.abs(positionDiff);
    let moveTimeMs = (movePercentage / 100) * MIXER_FULL_TIME * 1000;
    
    log("Bewege Mischer: " + currentPosition + "% -> " + targetPosition + "% (" + 
        Math.round(moveTimeMs / 1000) + "s)");
    
    // Richtung bestimmen und Bewegung starten
    let command = positionDiff > 0 ? "Cover.Open" : "Cover.Close";
    
    Shelly.call(command, { id: COVER_ID }, function(result) {
        // Bewegung gestartet
        
        // Timer zum Stoppen nach berechneter Zeit
        Timer.set(moveTimeMs, false, function() {
            stopMixer();
            currentPosition = targetPosition;
            lastMoveTime = now();
            
            // Zurueck zum vorherigen Zustand
            if (!emergencyActive) {
                setState(STATE.AUTO);
            } else {
                setState(STATE.EMERGENCY);
            }
            
            log("Position erreicht: " + currentPosition + "%");
        });
        
    }, function(error_code, error_message) {
        log("Fehler beim Starten der Bewegung: " + error_message);
        isMoving = false;
        setState(STATE.ERROR);
    });
    
    return true;
}

/*********** NOTFALL-FUNKTIONEN ***********/

/**
 * Prueft den Pufferspeicher und aktiviert ggf. den Notfall-Modus
 */
function checkBufferEmergency() {
    // Puffer-Temperatur lesen
    if (!readBufferTemp()) {
        return; // Sensor-Fehler, naechster Versuch beim naechsten Timer
    }
    
    // Notfall aktivieren wenn Puffer zu kalt
    if (!emergencyActive && bufferTemp < BUFFER_EMERGENCY_MIN) {
        emergencyActive = true;
        emergencyStartTime = now();
        setState(STATE.EMERGENCY);
        
        log("!!! NOTFALL AKTIVIERT !!! Puffer zu kalt: " + bufferTemp + "°C");
        
        // PID zuruecksetzen
        integral = 0;
        lastError = 0;
        
        // Mischer sofort auf 0% (zu) fahren
        moveMixerTo(0, true);
    }
    // Notfall deaktivieren wenn Puffer wieder warm genug
    else if (emergencyActive && bufferTemp >= BUFFER_EMERGENCY_OK) {
        emergencyActive = false;
        let emergencyDuration = Math.round((now() - emergencyStartTime) / 1000);
        
        log("Notfall beendet nach " + emergencyDuration + "s. Puffer: " + bufferTemp + "°C");
        
        setState(STATE.AUTO);
        
        // PID neu initialisieren
        pidInitialized = false;
        lastPidTime = now();
    }
    // Status-Update waehrend Notfall
    else if (emergencyActive) {
        log("Notfall aktiv - Puffer: " + bufferTemp + "°C, Position: " + currentPosition + "%");
        
        // Sicherstellen dass Mischer geschlossen bleibt
        if (currentPosition > 5 && !isMoving) {
            moveMixerTo(0, true);
        }
    }
}

/*********** PID-REGELUNG ***********/

/**
 * Initialisiert die PID-Regelung
 */
function initializePID() {
    if (vorlaufTemp === null) {
        log("PID Init: Warte auf gueltige Temperatur");
        return false;
    }
    
    lastError = setpoint - vorlaufTemp;
    integral = 0;
    lastPidTime = now();
    pidInitialized = true;
    
    log("PID initialisiert - Sollwert: " + setpoint + "°C, Ist: " + vorlaufTemp + "°C");
    return true;
}

/**
 * Fuehrt einen PID-Regelschritt durch
 */
function executePIDControl() {
    // Im Notfall keine PID-Regelung
    if (emergencyActive) {
        return;
    }
    
    // Vorlauf-Temperatur lesen
    if (!readVorlaufTemp()) {
        log("PID: Keine gueltige Temperatur");
        return;
    }
    
    // PID initialisieren falls noetig
    if (!pidInitialized) {
        if (!initializePID()) {
            return;
        }
    }
    
    // Sollwert aktualisieren
    readSetpoint();
    
    // PID-Parameter aktualisieren
    readPIDParameters();
    
    // Fehler berechnen
    let error = setpoint - vorlaufTemp;
    
    // Wenn bereits am Ziel, nichts tun
    if (Math.abs(error) < 0.3) {
        log("PID: Ziel erreicht (Abweichung: " + error.toFixed(2) + "°C)");
        integral = 0; // Integral zuruecksetzen
        return;
    }
    
    // Zeitdifferenz berechnen
    let currentTime = now();
    let dt = (currentTime - lastPidTime) / 1000; // in Sekunden
    lastPidTime = currentTime;
    
    // Sicherheitscheck fuer dt
    if (dt <= 0 || dt > 300) {
        log("PID: Ungueltige Zeitdifferenz dt=" + dt + "s, ueberspringe Berechnung");
        lastError = error;
        return;
    }
    
    // Integral (mit Anti-Windup)
    integral += error * dt;
    integral = clamp(integral, -50, 50);
    
    // Derivative
    let derivative = (error - lastError) / dt;
    lastError = error;
    
    // PID-Output berechnen
    let pTerm = Kp * error;
    let iTerm = Ki * integral;
    let dTerm = Kd * derivative;
    let output = pTerm + iTerm + dTerm;
    
    // Output begrenzen (max. 15% Aenderung pro Schritt)
    output = clamp(output, -15, 15);
    
    // Neue Position berechnen
    let newPosition = currentPosition + output;
    newPosition = clamp(newPosition, MIN_POSITION, MAX_POSITION);
    
    log("PID: Ist=" + vorlaufTemp.toFixed(1) + "°C, Soll=" + setpoint + "°C, " +
        "Fehler=" + error.toFixed(2) + "°C, Output=" + output.toFixed(2) + "%, " +
        "Neu=" + newPosition.toFixed(1) + "%, " +
        "P=" + pTerm.toFixed(2) + " I=" + iTerm.toFixed(2) + " D=" + dTerm.toFixed(2));
    
    // Mischer bewegen
    moveMixerTo(newPosition, false);
}

/*********** INITIALISIERUNG ***********/

/**
 * Initialisiert das Script beim Start
 */
function initialize() {
    log("========================================");
    log("Shelly 2PM PID-Mischer Steuerung v2.0");
    log("========================================");
    
    // Initiale Werte lesen
    log("Lese initiale Werte...");
    readVorlaufTemp();
    readBufferTemp();
    readSetpoint();
    readPIDParameters();
    
    // Status ausgeben
    log("Vorlauf: " + (vorlaufTemp !== null ? vorlaufTemp + "°C" : "N/A"));
    log("Puffer: " + (bufferTemp !== null ? bufferTemp + "°C" : "N/A"));
    log("Sollwert: " + setpoint + "°C");
    log("Mischer-Position: " + currentPosition + "%");
    log("PID: Kp=" + Kp + ", Ki=" + Ki + ", Kd=" + Kd);
    
    // Initialen Zustand setzen
    setState(STATE.AUTO);
    
    // Pruefe sofort ob Notfall vorliegt
    checkBufferEmergency();
    
    log("Initialisierung abgeschlossen");
    log("========================================");
}

/*********** TIMER-SETUP ***********/

// Initialisierung beim Start
initialize();

// Timer 1: Temperatur-Abfrage (10 Sekunden)
Timer.set(TEMP_READ_INTERVAL, true, function() {
    readVorlaufTemp();
});

// Timer 2: Puffer-Ueberwachung (30 Sekunden)
Timer.set(BUFFER_CHECK_INTERVAL, true, function() {
    checkBufferEmergency();
});

// Timer 3: PID-Berechnung (2,5 Minuten)
Timer.set(PID_CALC_INTERVAL, true, function() {
    executePIDControl();
});

log("Alle Timer gestartet");
log("- Temperatur-Abfrage: alle " + (TEMP_READ_INTERVAL / 1000) + "s");
log("- Puffer-Check: alle " + (BUFFER_CHECK_INTERVAL / 1000) + "s");
log("- PID-Berechnung: alle " + (PID_CALC_INTERVAL / 1000) + "s");
