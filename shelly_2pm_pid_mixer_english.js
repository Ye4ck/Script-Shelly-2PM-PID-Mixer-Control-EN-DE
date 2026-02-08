/*********** CONFIGURATION ***********/
// Hardware IDs
let COVER_ID = 0;                    // Shelly 2PM Cover / Shutter ID
let TEMP_SENSOR_ID = 101;            // Flow temperature sensor ID
let BUFFER_SENSOR_ID = 100;          // Buffer storage sensor ID

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
let BUFFER_CHECK_INTERVAL = 30000;   // Buffer check: 30 seconds
let MIN_MOVE_PAUSE = 30000;          // Minimum pause between movements: 30 seconds

// Mixer Configuration
let MIXER_FULL_TIME = 120;           // Seconds for 0-100% travel
let MIN_POSITION = 0;                // Minimum position (closed)
let MAX_POSITION = 100;              // Maximum position (open)

// Emergency Thresholds
let BUFFER_EMERGENCY_MIN = 40;       // Below 40°C -> Emergency
let BUFFER_EMERGENCY_OK = 45;        // Above 45°C -> Emergency cleared

/*********** OPERATING STATES ***********/
let STATE = {
    AUTO: "AUTO",
    EMERGENCY: "EMERGENCY",
    MOVING: "MOVING",
    PAUSE: "PAUSE",
    ERROR: "ERROR"
};

/*********** GLOBAL VARIABLES ***********/
let currentState = STATE.AUTO;
let previousState = STATE.AUTO;

// Temperature Data
let flowTemp = null;                 // Current flow temperature
let bufferTemp = null;               // Current buffer temperature
let setpoint = 25;                   // Setpoint temperature

// Mixer State
let currentPosition = 50;            // Current position (0-100%)
let targetPosition = 50;             // Target position
let isMoving = false;                // Movement flag
let lastMoveTime = 0;                // Timestamp of last movement

// PID Variables
let integral = 0;
let lastError = 0;
let lastPidTime = Date.now();
let pidInitialized = false;

// Emergency Status
let emergencyActive = false;
let emergencyStartTime = 0;

/*********** UTILITY FUNCTIONS ***********/

/**
 * Clamps a value between min and max
 */
function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
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
    if (currentState !== newState) {
        previousState = currentState;
        currentState = newState;
        
        // Update text component
        Shelly.call("Text.Set", { 
            id: STATE_TEXT_ID, 
            value: newState 
        }, function(result) {
            // Success
        }, function(error_code, error_message) {
            print("Error setting status:", error_message);
        });
        
        print("State change:", previousState, "->", newState);
    }
}

/**
 * Logs a message with timestamp
 */
function log(message) {
    print("[" + new Date().toISOString() + "]", message);
}

/*********** SENSOR FUNCTIONS ***********/

/**
 * Reads the flow temperature
 */
function readFlowTemp() {
    try {
        let status = Shelly.getComponentStatus('temperature', TEMP_SENSOR_ID);
        if (status && typeof status.tC === 'number') {
            flowTemp = status.tC;
            return true;
        } else {
            log("Flow sensor: Invalid value");
            flowTemp = null;
            return false;
        }
    } catch (e) {
        log("Error reading flow sensor: " + e);
        flowTemp = null;
        return false;
    }
}

/**
 * Reads the buffer storage temperature
 */
function readBufferTemp() {
    try {
        let status = Shelly.getComponentStatus('temperature', BUFFER_SENSOR_ID);
        if (status && typeof status.tC === 'number') {
            bufferTemp = status.tC;
            return true;
        } else {
            log("Buffer sensor: Invalid value");
            bufferTemp = null;
            return false;
        }
    } catch (e) {
        log("Error reading buffer sensor: " + e);
        bufferTemp = null;
        return false;
    }
}

/**
 * Reads the setpoint from the virtual component
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
        log("Invalid setpoint, using default: " + setpoint);
        return false;
    } catch (e) {
        log("Error reading setpoint: " + e);
        return false;
    }
}

/**
 * Reads PID parameters from virtual components
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
        
        log("PID parameters: Kp=" + Kp + ", Ki=" + Ki + ", Kd=" + Kd);
        return true;
    } catch (e) {
        log("Error reading PID parameters: " + e);
        return false;
    }
}

/*********** MIXER CONTROL ***********/

/**
 * Stops the current mixer movement
 */
function stopMixer() {
    Shelly.call("Cover.Stop", { id: COVER_ID }, function(result) {
        isMoving = false;
        log("Mixer stopped at position: " + currentPosition + "%");
    }, function(error_code, error_message) {
        log("Error stopping mixer: " + error_message);
        isMoving = false;
    });
}

/**
 * Moves the mixer to a target position
 */
function moveMixerTo(newTargetPosition, forceMove) {
    // Default value for forceMove
    if (forceMove === undefined) {
        forceMove = false;
    }
    
    // Clamp position
    newTargetPosition = clamp(newTargetPosition, MIN_POSITION, MAX_POSITION);
    
    // Check if movement is already in progress
    if (isMoving && !forceMove) {
        log("Mixer already moving - ignoring command");
        return false;
    }
    
    // Check if pause must be observed
    let timeSinceLastMove = now() - lastMoveTime;
    if (timeSinceLastMove < MIN_MOVE_PAUSE && !forceMove) {
        log("Minimum pause still active (" + Math.round((MIN_MOVE_PAUSE - timeSinceLastMove) / 1000) + "s)");
        setState(STATE.PAUSE);
        return false;
    }
    
    // Calculate difference
    let positionDiff = newTargetPosition - currentPosition;
    
    // Ignore too small changes
    if (Math.abs(positionDiff) < 1 && !forceMove) {
        log("Position already reached (" + currentPosition + "%)");
        return false;
    }
    
    // Start movement
    targetPosition = newTargetPosition;
    isMoving = true;
    setState(STATE.MOVING);
    
    // Calculate travel time
    let movePercentage = Math.abs(positionDiff);
    let moveTimeMs = (movePercentage / 100) * MIXER_FULL_TIME * 1000;
    
    log("Moving mixer: " + currentPosition + "% -> " + targetPosition + "% (" + 
        Math.round(moveTimeMs / 1000) + "s)");
    
    // Determine direction and start movement
    let command = positionDiff > 0 ? "Cover.Open" : "Cover.Close";
    
    Shelly.call(command, { id: COVER_ID }, function(result) {
        // Movement started
        
        // Timer to stop after calculated time
        Timer.set(moveTimeMs, false, function() {
            stopMixer();
            currentPosition = targetPosition;
            lastMoveTime = now();
            
            // Return to previous state
            if (!emergencyActive) {
                setState(STATE.AUTO);
            } else {
                setState(STATE.EMERGENCY);
            }
            
            log("Position reached: " + currentPosition + "%");
        });
        
    }, function(error_code, error_message) {
        log("Error starting movement: " + error_message);
        isMoving = false;
        setState(STATE.ERROR);
    });
    
    return true;
}

/*********** EMERGENCY FUNCTIONS ***********/

/**
 * Checks the buffer storage and activates emergency mode if necessary
 */
function checkBufferEmergency() {
    // Read buffer temperature
    if (!readBufferTemp()) {
        return; // Sensor error, try again on next timer
    }
    
    // Activate emergency if buffer too cold
    if (!emergencyActive && bufferTemp < BUFFER_EMERGENCY_MIN) {
        emergencyActive = true;
        emergencyStartTime = now();
        setState(STATE.EMERGENCY);
        
        log("!!! EMERGENCY ACTIVATED !!! Buffer too cold: " + bufferTemp + "°C");
        
        // Reset PID
        integral = 0;
        lastError = 0;
        
        // Immediately move mixer to 0% (closed)
        moveMixerTo(0, true);
    }
    // Deactivate emergency when buffer warm enough again
    else if (emergencyActive && bufferTemp >= BUFFER_EMERGENCY_OK) {
        emergencyActive = false;
        let emergencyDuration = Math.round((now() - emergencyStartTime) / 1000);
        
        log("Emergency ended after " + emergencyDuration + "s. Buffer: " + bufferTemp + "°C");
        
        setState(STATE.AUTO);
        
        // Reinitialize PID
        pidInitialized = false;
        lastPidTime = now();
    }
    // Status update during emergency
    else if (emergencyActive) {
        log("Emergency active - Buffer: " + bufferTemp + "°C, Position: " + currentPosition + "%");
        
        // Ensure mixer stays closed
        if (currentPosition > 5 && !isMoving) {
            moveMixerTo(0, true);
        }
    }
}

/*********** PID CONTROL ***********/

/**
 * Initializes the PID controller
 */
function initializePID() {
    if (flowTemp === null) {
        log("PID Init: Waiting for valid temperature");
        return false;
    }
    
    lastError = setpoint - flowTemp;
    integral = 0;
    lastPidTime = now();
    pidInitialized = true;
    
    log("PID initialized - Setpoint: " + setpoint + "°C, Actual: " + flowTemp + "°C");
    return true;
}

/**
 * Executes a PID control step
 */
function executePIDControl() {
    // No PID control during emergency
    if (emergencyActive) {
        return;
    }
    
    // Read flow temperature
    if (!readFlowTemp()) {
        log("PID: No valid temperature");
        return;
    }
    
    // Initialize PID if necessary
    if (!pidInitialized) {
        if (!initializePID()) {
            return;
        }
    }
    
    // Update setpoint
    readSetpoint();
    
    // Update PID parameters
    readPIDParameters();
    
    // Calculate error
    let error = setpoint - flowTemp;
    
    // If already at target, do nothing
    if (Math.abs(error) < 0.3) {
        log("PID: Target reached (deviation: " + error.toFixed(2) + "°C)");
        integral = 0; // Reset integral
        return;
    }
    
    // Calculate time difference
    let currentTime = now();
    let dt = (currentTime - lastPidTime) / 1000; // in seconds
    lastPidTime = currentTime;
    
    // Safety check for dt
    if (dt <= 0 || dt > 300) {
        log("PID: Invalid time difference dt=" + dt + "s, skipping calculation");
        lastError = error;
        return;
    }
    
    // Integral (with anti-windup)
    integral += error * dt;
    integral = clamp(integral, -50, 50);
    
    // Derivative
    let derivative = (error - lastError) / dt;
    lastError = error;
    
    // Calculate PID output
    let pTerm = Kp * error;
    let iTerm = Ki * integral;
    let dTerm = Kd * derivative;
    let output = pTerm + iTerm + dTerm;
    
    // Limit output (max. 15% change per step)
    output = clamp(output, -15, 15);
    
    // Calculate new position
    let newPosition = currentPosition + output;
    newPosition = clamp(newPosition, MIN_POSITION, MAX_POSITION);
    
    log("PID: Actual=" + flowTemp.toFixed(1) + "°C, Setpoint=" + setpoint + "°C, " +
        "Error=" + error.toFixed(2) + "°C, Output=" + output.toFixed(2) + "%, " +
        "New=" + newPosition.toFixed(1) + "%, " +
        "P=" + pTerm.toFixed(2) + " I=" + iTerm.toFixed(2) + " D=" + dTerm.toFixed(2));
    
    // Move mixer
    moveMixerTo(newPosition, false);
}

/*********** INITIALIZATION ***********/

/**
 * Initializes the script at startup
 */
function initialize() {
    log("========================================");
    log("Shelly 2PM PID Mixer Control v2.0");
    log("========================================");
    
    // Read initial values
    log("Reading initial values...");
    readFlowTemp();
    readBufferTemp();
    readSetpoint();
    readPIDParameters();
    
    // Output status
    log("Flow: " + (flowTemp !== null ? flowTemp + "°C" : "N/A"));
    log("Buffer: " + (bufferTemp !== null ? bufferTemp + "°C" : "N/A"));
    log("Setpoint: " + setpoint + "°C");
    log("Mixer position: " + currentPosition + "%");
    log("PID: Kp=" + Kp + ", Ki=" + Ki + ", Kd=" + Kd);
    
    // Set initial state
    setState(STATE.AUTO);
    
    // Check immediately if emergency exists
    checkBufferEmergency();
    
    log("Initialization complete");
    log("========================================");
}

/*********** TIMER SETUP ***********/

// Initialize at startup
initialize();

// Timer 1: Temperature query (10 seconds)
Timer.set(TEMP_READ_INTERVAL, true, function() {
    readFlowTemp();
});

// Timer 2: Buffer monitoring (30 seconds)
Timer.set(BUFFER_CHECK_INTERVAL, true, function() {
    checkBufferEmergency();
});

// Timer 3: PID calculation (2.5 minutes)
Timer.set(PID_CALC_INTERVAL, true, function() {
    executePIDControl();
});

log("All timers started");
log("- Temperature query: every " + (TEMP_READ_INTERVAL / 1000) + "s");
log("- Buffer check: every " + (BUFFER_CHECK_INTERVAL / 1000) + "s");
log("- PID calculation: every " + (PID_CALC_INTERVAL / 1000) + "s");
