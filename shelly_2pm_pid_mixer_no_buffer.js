/*********** CONFIGURATION ***********/
// Hardware IDs
let COVER_ID = 0;                    // Shelly 2PM Cover / Shutter ID
let TEMP_SENSOR_ID = 101;            // Flow temperature sensor ID

// Virtual Component IDs
let SETPOINT_ID = "number:200";      // Temperature setpoint (degrees)
let PID_KP_ID = "number:201";        // PID Parameter Kp
let PID_KI_ID = "number:202";        // PID Parameter Ki
let PID_KD_ID = "number:203";        // PID Parameter Kd
let STATE_TEXT_ID = 200;             // Text component for operating state

// PID Default Parameters
let Kp = 6.0;
let Ki = 0.03;
let Kd = 2.0;

// Timing Configuration (in milliseconds)
let TEMP_READ_INTERVAL = 10000;      // Temperature query: 10 seconds
let PID_CALC_INTERVAL = 150000;      // PID calculation: 2.5 minutes
let MIN_MOVE_PAUSE = 60000;          // Minimum pause between movements: 60 seconds

// Mixer Configuration
let MIXER_FULL_TIME = 120;           // Seconds for 0-100% travel
let MIN_POSITION = 0;                // Minimum position (closed)
let MAX_POSITION = 100;              // Maximum position (open)
let MIN_MOVE_PERCENT = 2;            // Minimum change to trigger movement (integer)

// PID Anti-Windup Limits
let INTEGRAL_MIN = -50;
let INTEGRAL_MAX = 50;
let OUTPUT_STEP_LIMIT = 15;          // Max % change per PID step

/*********** OPERATING STATES ***********/
let STATE = {
    AUTO: "AUTO",
    MOVING: "MOVING",
    PAUSE: "PAUSE",
    ERROR: "ERROR"
};

/*********** GLOBAL VARIABLES ***********/
let currentState = STATE.AUTO;
let previousState = STATE.AUTO;

// Temperature Data
let flowTemp = null;                 // Current flow temperature
let setpoint = 25;                   // Setpoint temperature

// Mixer State
let currentPosition = 50;            // Current position (0-100%, integer)
let targetPosition = 50;             // Target position (integer)
let isMoving = false;                // Movement flag
let lastMoveTime = 0;                // Timestamp of last movement
let moveTimer = null;                // Reference to active movement timer

// PID Variables
let integral = 0;
let lastError = 0;
let lastPidTime = 0;
let pidInitialized = false;

/*********** UTILITY FUNCTIONS ***********/

/**
 * Clamps a value between min and max
 */
function clamp(value, min, max) {
    if (value < min) return min;
    if (value > max) return max;
    return value;
}

/**
 * Rounds to nearest even integer (gerade Zahl)
 * E.g. 23 -> 22, 25 -> 26, 51 -> 52
 */
function roundToEven(value) {
    let rounded = Math.round(value);
    if (rounded % 2 !== 0) {
        // Odd number: round towards the direction of the original value
        if (value > rounded) {
            rounded += 1;
        } else {
            rounded -= 1;
        }
    }
    return rounded;
}

/**
 * Converts a position to a valid even integer within bounds
 */
function toValidPosition(value) {
    let pos = roundToEven(value);
    return clamp(pos, MIN_POSITION, MAX_POSITION);
}

/**
 * Current time in milliseconds
 */
function now() {
    return Date.now();
}

/**
 * Sets the operating state and updates the text component
 */
function setState(newState) {
    if (currentState === newState) return;
    
    previousState = currentState;
    currentState = newState;
    
    Shelly.call("Text.Set", {
        id: STATE_TEXT_ID,
        value: newState
    }, null, function(error_code, error_message) {
        print("Error setting status: " + error_message);
    });
    
    log("State: " + previousState + " -> " + newState);
}

/**
 * Logs a message with timestamp
 */
function log(message) {
    print("[" + new Date().toISOString() + "] " + message);
}

/*********** SENSOR FUNCTIONS ***********/

/**
 * Reads a temperature sensor by ID, returns value or null
 */
function readTempSensor(sensorId, sensorName) {
    let status = Shelly.getComponentStatus("temperature", sensorId);
    if (status && typeof status.tC === "number") {
        return status.tC;
    }
    log(sensorName + ": Invalid or missing value");
    return null;
}

/**
 * Reads the flow temperature
 */
function readFlowTemp() {
    let value = readTempSensor(TEMP_SENSOR_ID, "Flow sensor");
    if (value !== null) {
        flowTemp = value;
        return true;
    }
    flowTemp = null;
    return false;
}

/**
 * Reads the setpoint from the virtual component
 */
function readSetpoint() {
    try {
        let handle = Virtual.getHandle(SETPOINT_ID);
        if (handle !== undefined) {
            let value = handle.getValue();
            if (typeof value === "number" && value > 0 && value < 100) {
                setpoint = value;
                return true;
            }
        }
    } catch (e) {
        log("Error reading setpoint: " + e);
    }
    log("Invalid setpoint, using: " + setpoint);
    return false;
}

/**
 * Reads a single PID parameter from a virtual component
 */
function readSinglePID(componentId, currentValue) {
    try {
        let handle = Virtual.getHandle(componentId);
        if (handle !== undefined) {
            let value = handle.getValue();
            if (typeof value === "number" && value >= 0) {
                return value;
            }
        }
    } catch (e) {
        // Keep current value on error
    }
    return currentValue;
}

/**
 * Reads PID parameters from virtual components
 */
function readPIDParameters() {
    Kp = readSinglePID(PID_KP_ID, Kp);
    Ki = readSinglePID(PID_KI_ID, Ki);
    Kd = readSinglePID(PID_KD_ID, Kd);
    log("PID: Kp=" + Kp + ", Ki=" + Ki + ", Kd=" + Kd);
}

/*********** MIXER CONTROL ***********/

/**
 * Stops the current mixer movement
 */
function stopMixer() {
    // Cancel pending movement timer
    if (moveTimer !== null) {
        Timer.clear(moveTimer);
        moveTimer = null;
    }
    
    Shelly.call("Cover.Stop", { id: COVER_ID }, function() {
        isMoving = false;
        log("Mixer stopped at: " + currentPosition + "%");
    }, function(error_code, error_message) {
        log("Error stopping mixer: " + error_message);
        isMoving = false;
    });
}

/**
 * Moves the mixer to a target position (even integer)
 * @param {number} newTargetPosition - Desired position (will be rounded to even int)
 * @param {boolean} forceMove - Skip pause/movement checks
 * @returns {boolean} - Whether movement was started
 */
function moveMixerTo(newTargetPosition, forceMove) {
    if (forceMove === undefined) forceMove = false;
    
    // Convert to valid even integer position
    newTargetPosition = toValidPosition(newTargetPosition);
    
    // Check if movement is already in progress
    if (isMoving && !forceMove) {
        log("Mixer busy - ignoring");
        return false;
    }
    
    // Force: stop current movement first
    if (isMoving && forceMove) {
        stopMixer();
    }
    
    // Check minimum pause
    let timeSinceLastMove = now() - lastMoveTime;
    if (timeSinceLastMove < MIN_MOVE_PAUSE && !forceMove) {
        let remaining = Math.round((MIN_MOVE_PAUSE - timeSinceLastMove) / 1000);
        log("Pause active (" + remaining + "s remaining)");
        setState(STATE.PAUSE);
        return false;
    }
    
    // Calculate difference
    let positionDiff = newTargetPosition - currentPosition;
    
    // Ignore too small changes
    if (Math.abs(positionDiff) < MIN_MOVE_PERCENT && !forceMove) {
        log("Position OK (" + currentPosition + "%)");
        return false;
    }
    
    // Start movement
    targetPosition = newTargetPosition;
    isMoving = true;
    setState(STATE.MOVING);
    
    // Calculate travel time
    let movePercentage = Math.abs(positionDiff);
    let moveTimeMs = Math.round((movePercentage / 100) * MIXER_FULL_TIME * 1000);
    
    // Minimum travel time safety
    if (moveTimeMs < 500) moveTimeMs = 500;
    
    log("Move: " + currentPosition + "% -> " + targetPosition +
        "% (diff=" + positionDiff + "%, time=" + Math.round(moveTimeMs / 1000) + "s)");
    
    // Determine direction
    let command = positionDiff > 0 ? "Cover.Open" : "Cover.Close";
    
    Shelly.call(command, { id: COVER_ID }, function() {
        // Movement started - set stop timer
        moveTimer = Timer.set(moveTimeMs, false, function() {
            moveTimer = null;
            stopMixer();
            currentPosition = targetPosition;
            lastMoveTime = now();
            
            setState(STATE.AUTO);
            
            log("Position reached: " + currentPosition + "%");
        });
        
    }, function(error_code, error_message) {
        log("Error starting movement: " + error_message);
        isMoving = false;
        setState(STATE.ERROR);
    });
    
    return true;
}

/*********** PID CONTROL ***********/

/**
 * Initializes the PID controller
 */
function initializePID() {
    if (flowTemp === null) {
        log("PID Init: Waiting for temperature");
        return false;
    }
    
    lastError = setpoint - flowTemp;
    integral = 0;
    lastPidTime = now();
    pidInitialized = true;
    
    log("PID initialized - Setpoint=" + setpoint + "°C, Actual=" + flowTemp + "°C");
    return true;
}

/**
 * Executes a PID control step
 */
function executePIDControl() {
    // Read flow temperature
    if (!readFlowTemp()) {
        log("PID: No valid temperature");
        return;
    }
    
    // Initialize PID if necessary
    if (!pidInitialized) {
        if (!initializePID()) return;
        // Skip first calculation after init to get a valid dt next time
        return;
    }
    
    // Update setpoint and parameters
    readSetpoint();
    readPIDParameters();
    
    // Calculate error
    let error = setpoint - flowTemp;
    
    // Dead band: if close enough, just reset integral and skip
    if (Math.abs(error) < 0.3) {
        log("PID: On target (deviation=" + error.toFixed(2) + "°C)");
        integral = 0;
        lastError = error;
        return;
    }
    
    // Calculate time difference
    let currentTime = now();
    let dt = (currentTime - lastPidTime) / 1000;
    lastPidTime = currentTime;
    
    // Safety check for dt
    if (dt <= 0 || dt > 600) {
        log("PID: Invalid dt=" + dt + "s, resetting");
        lastError = error;
        return;
    }
    
    // P term
    let pTerm = Kp * error;
    
    // I term with anti-windup
    // Only accumulate integral when output is not saturated
    let tentativeIntegral = integral + error * dt;
    tentativeIntegral = clamp(tentativeIntegral, INTEGRAL_MIN, INTEGRAL_MAX);
    
    // Back-calculation anti-windup: don't wind up if we're at position limits
    if ((currentPosition >= MAX_POSITION && error > 0) ||
        (currentPosition <= MIN_POSITION && error < 0)) {
        // Don't accumulate integral when saturated in the wrong direction
        log("PID: Anti-windup active (position at limit)");
    } else {
        integral = tentativeIntegral;
    }
    let iTerm = Ki * integral;
    
    // D term
    let derivative = (error - lastError) / dt;
    let dTerm = Kd * derivative;
    lastError = error;
    
    // Calculate PID output
    let output = pTerm + iTerm + dTerm;
    
    // Limit output per step
    output = clamp(output, -OUTPUT_STEP_LIMIT, OUTPUT_STEP_LIMIT);
    
    // Calculate new position (even integer)
    let newPosition = toValidPosition(currentPosition + output);
    
    log("PID: T=" + flowTemp.toFixed(1) + "°C, SP=" + setpoint + "°C, " +
        "E=" + error.toFixed(2) + ", Out=" + output.toFixed(2) + "%, " +
        "Pos=" + currentPosition + "->" + newPosition + "%, " +
        "P=" + pTerm.toFixed(2) + " I=" + iTerm.toFixed(2) + " D=" + dTerm.toFixed(2));
    
    // Move mixer
    moveMixerTo(newPosition, false);
}

/*********** INITIALIZATION ***********/

function initialize() {
    log("========================================");
    log("Shelly 2PM PID Mixer Control v2.1 (no buffer)");
    log("========================================");
    
    // Read initial values
    readFlowTemp();
    readSetpoint();
    readPIDParameters();
    
    // Ensure starting position is even
    currentPosition = toValidPosition(currentPosition);
    targetPosition = currentPosition;
    
    log("Flow: " + (flowTemp !== null ? flowTemp + "°C" : "N/A"));
    log("Setpoint: " + setpoint + "°C");
    log("Position: " + currentPosition + "%");
    
    setState(STATE.AUTO);
    
    // Set lastPidTime so first PID cycle has valid dt
    lastPidTime = now();
    
    log("Init complete");
    log("========================================");
}

/*********** TIMER SETUP ***********/

initialize();

// Timer 1: Temperature query (10s)
Timer.set(TEMP_READ_INTERVAL, true, function() {
    readFlowTemp();
});

// Timer 2: PID calculation (2.5 min)
Timer.set(PID_CALC_INTERVAL, true, function() {
    executePIDControl();
});

log("Timers: Temp=" + (TEMP_READ_INTERVAL / 1000) + "s, " +
    "PID=" + (PID_CALC_INTERVAL / 1000) + "s");
