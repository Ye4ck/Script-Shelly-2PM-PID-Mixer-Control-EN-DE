# Shelly 2PM PID Mixer Control

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Shelly Gen2+](https://img.shields.io/badge/Shelly-Gen2+-blue.svg)](https://www.shelly.com/)

An intelligent PID controller for heating mixers based on the Shelly 2PM with integrated emergency function to protect the buffer storage.

[🇩🇪 Deutsche Version](README_DE.md)

## v2.1 fixed position Drift (GoToPosition - no manual timing)

## 🔐 Safety Notes

⚠️ **IMPORTANT**:
- This script controls your heating system
- Test thoroughly in a safe environment
- Monitor the system intensively in the first few days
- Ensure emergency shutdowns work
- When in doubt: Consult a professional

## 📋 Table of Contents

- [Features](#-features)
- [System Requirements](#-system-requirements)
- [Installation](#-installation)
- [Configuration](#️-configuration)
- [How It Works](#-how-it-works)
- [Emergency Mode](#-emergency-mode)
- [PID Parameter Tuning](#-pid-parameter-tuning)
- [Troubleshooting](#-troubleshooting)
- [License](#-license)

## ✨ Features

- **🎯 PID Control**: Precise temperature control with adjustable parameters (Kp, Ki, Kd)
- **🚨 Emergency Protection**: Automatic mixer closing when buffer storage temperature is too low
- **📊 State Monitoring**: Real-time status display via virtual text component
- **⏱️ Smart Timers**: Optimized query intervals to protect hardware
- **🔒 Anti-Windup**: Back-calculation anti-windup prevents integral overflow at position limits
- **📝 Detailed Logging**: Comprehensive debug output for troubleshooting
- **🛡️ Fault Tolerance**: Robust error handling for sensor failures
- **🔢 Integer Positions**: All mixer positions are even integers (0, 2, 4, ... 100) for Shelly compatibility

## 🔧 System Requirements

### Hardware
- **Shelly 2PM** (Gen2 Pro or Gen3 and above)
- **2x DS18B20 Temperature Sensors** (or compatible)
  - Sensor 100: Buffer storage sensor
  - Sensor 101: Flow temperature sensor
- **Mixer Motor** (0-100% in 120 seconds)

### Software
- Shelly Firmware Gen2+ with JavaScript support
- Virtual components enabled

## 📥 Installation

### Step 1: Set up Virtual Components

Create the following virtual components in your Shelly 2PM:

| Type | ID | Name | Default | Description |
|-----|-----|------|---------|-------------|
| Number | 200 | Setpoint | 25 | Target temperature in °C |
| Number | 201 | PID Kp | 6.0 | Proportional factor |
| Number | 202 | PID Ki | 0.03 | Integral factor |
| Number | 203 | PID Kd | 2.0 | Derivative factor |
| Text | 200 | Status | AUTO | Operating state |

### Step 2: Assign Temperature Sensors

Ensure temperature sensors are correctly connected and assigned:
- **Sensor ID 100**: Buffer storage
- **Sensor ID 101**: Flow temperature

### Step 3: Upload Script

1. Open the Shelly web interface
2. Navigate to **Scripts** → **Library**
3. Create a new script
4. Copy the contents of `shelly_2pm_pid_mixer_v2.js`
5. Save and **activate script**

### Step 4: Adjust Configuration

Adjust the configuration values at the beginning of the script to match your system:

```javascript
/*********** CONFIGURATION ***********/
let COVER_ID = 0;                    // Your Shelly Cover ID
let TEMP_SENSOR_ID = 101;            // Flow sensor
let BUFFER_SENSOR_ID = 100;          // Buffer sensor

// Adjust mixer travel time (seconds for 0-100%)
let MIXER_FULL_TIME = 120;

// Emergency thresholds
let BUFFER_EMERGENCY_MIN = 40;       // Below 40°C -> Emergency
let BUFFER_EMERGENCY_OK = 45;        // Above 45°C -> Normal
```

## ⚙️ Configuration

### Mixer Calibration

Determine your mixer's travel time from 0% to 100%:

1. Close the mixer completely (manually)
2. Measure the time until fully open
3. Enter the value in `MIXER_FULL_TIME` (in seconds)

**Example**: Your mixer takes 2 minutes for full travel → `MIXER_FULL_TIME = 120`

### Timer Intervals

Default timers are optimized for most applications:

```javascript
let TEMP_READ_INTERVAL = 10000;      // 10 seconds - Temperature query
let PID_CALC_INTERVAL = 150000;      // 2.5 minutes - PID calculation
let BUFFER_CHECK_INTERVAL = 30000;   // 30 seconds - Buffer check
let MIN_MOVE_PAUSE = 60000;          // 60 seconds - Pause between movements
```

**Recommendations**:
- **Sluggish system** (large water volume): Increase intervals
- **Fast system** (small piping): Decrease intervals
- **Critical buffer**: Reduce `BUFFER_CHECK_INTERVAL`

### Position Handling

All mixer positions are handled as **even integers** (0, 2, 4, ... 100). This ensures compatibility with the Shelly 2PM's integer-based Cover component. The minimum movement threshold (`MIN_MOVE_PERCENT`) is set to 2% accordingly.

## 🔄 How It Works

### PID Control Loop

```
Setpoint - Actual Temperature = Error
         ↓
    ┌────────────────┐
    │  P: Kp × Error │
    │  I: Ki × ∫Error│
    │  D: Kd × dError│
    └────────────────┘
         ↓
   Output (±15% max)
         ↓
   Round to even integer
         ↓
   Mixer Position (0, 2, 4, ... 100)
```

### Control Cycle (every 2.5 minutes)

1. **Read temperature**: Get current flow temperature
2. **Calculate error**: `error = setpoint - flowTemp`
3. **Calculate PID**: Combine P, I and D terms
4. **Calculate position**: Determine new mixer position (rounded to even integer)
5. **Move mixer**: Move to position if necessary

### State Machine

```
AUTO ↔→ MOVING → AUTO
  ↓         ↓
EMERGENCY   PAUSE
  ↓         ↓
AUTO ↔→  ERROR
```

| State | Description |
|-------|-------------|
| **AUTO** | Normal PID operation |
| **MOVING** | Mixer is currently moving |
| **PAUSE** | Waiting time between movements |
| **EMERGENCY** | Emergency mode active |
| **ERROR** | Error occurred |

## 🚨 Emergency Mode

### Activation

Emergency mode is activated when:
- Buffer storage temperature drops **< 40°C**

**Automatic actions**:
1. ⚠️ Status changes to "EMERGENCY"
2. 🔒 PID control is disabled and reset
3. ⬇️ Mixer immediately moves to **0%** (closed)
4. ⏸️ Normal control pauses

### Deactivation

Emergency mode ends when:
- Buffer storage temperature reaches **≥ 45°C**

**Automatic actions**:
1. ✅ Status changes back to "AUTO"
2. 🔄 PID control is fully reinitialized
3. ▶️ Normal control resumes

### Hysteresis Effect

The **5°C hysteresis** (40°C to 45°C) prevents constant switching during temperature fluctuations.

```
Temperature
   │
45°├─────────────  ← Emergency OFF
   │   Normal
   │   Operation
40°├─────────────  ← Emergency ON
   │   Emergency
   │   Mixer CLOSED
   └──────────────> Time
```

## 🎛️ PID Parameter Tuning

### Method 1: Ziegler-Nichols (Simple)

1. Set Ki = 0, Kd = 0
2. Increase Kp until system oscillates
3. Use the following values:
   - Kp = 0.6 × Kp_critical
   - Ki = 1.2 × Kp / T_oscillation
   - Kd = 0.075 × Kp × T_oscillation

### Method 2: Manual Tuning

#### Step 1: P-Term (Kp)
- **Start**: Kp = 5.0
- **Too sluggish**: Increase Kp (e.g. +1.0)
- **Overshooting**: Decrease Kp (e.g. -0.5)
- **Goal**: Fast response without strong overshoot

#### Step 2: I-Term (Ki)
- **Start**: Ki = 0.03
- **Steady-state error**: Increase Ki (e.g. +0.01)
- **Unstable**: Decrease Ki (e.g. -0.01)
- **Goal**: No offset, stable control

#### Step 3: D-Term (Kd)
- **Start**: Kd = 2.0
- **Overshooting**: Increase Kd (e.g. +0.5)
- **Noise sensitive**: Decrease Kd (e.g. -0.5)
- **Goal**: Damped response to rapid changes

### Recommended Starting Values

| System Type | Kp | Ki | Kd |
|-------------|-----|-----|-----|
| **Floor heating** (sluggish) | 3.0 | 0.01 | 1.0 |
| **Radiator** (medium) | 6.0 | 0.03 | 2.0 |
| **Convector** (fast) | 10.0 | 0.05 | 3.0 |

### Test Procedure

1. Change parameters via virtual components
2. Observe behavior for 1-2 hours
3. Check log outputs for details
4. Iterate until optimal behavior is achieved

**Tip**: Always change only **one** parameter at a time!

## 🛠 Troubleshooting

### Problem: Mixer doesn't move

**Possible causes**:
- ✅ Check `COVER_ID` - is the ID correct?
- ✅ Check mixer wiring
- ✅ Check Shelly 2PM Cover configuration
- ✅ Check log: "Error starting movement"

**Solution**:
```javascript
// Should appear in log:
"Move: 50% -> 56% (diff=6%, time=7s)"
```

### Problem: No temperature values

**Possible causes**:
- ✅ Sensor IDs incorrectly configured
- ✅ Sensors not connected
- ✅ Sensors defective

**Solution**:
```javascript
// Check sensor IDs in Shelly web interface
// Temperature components → Note ID
```

### Problem: Constant emergency mode

**Possible causes**:
- ✅ Buffer actually too cold
- ✅ `BUFFER_EMERGENCY_MIN` set too high
- ✅ Wrong sensor configured as buffer

**Solution**:
```javascript
// Adjust thresholds:
let BUFFER_EMERGENCY_MIN = 35;  // Lower
let BUFFER_EMERGENCY_OK = 40;   // Lower
```

### Problem: System oscillates

**Symptom**: Mixer constantly moves back and forth

**Cause**: PID parameters too aggressive

**Solution**:
1. Reduce Kp by 50%
2. Reduce Ki by 50%
3. Increase Kd by 50%
4. Test and iterate

### Problem: System responds too slowly

**Symptom**: Temperature never reaches setpoint

**Cause**: PID parameters too conservative

**Solution**:
1. Increase Kp by 20%
2. Increase Ki by 20%
3. Test and iterate

## 📊 Logging and Monitoring

### Interpreting Log Output

```javascript
// Normal PID output:
"PID: T=42.5°C, SP=45°C, E=2.50, Out=5.23%, Pos=50->56%, P=15.00 I=-8.50 D=-1.27"
```

**Meaning**:
- `T`: Measured temperature
- `SP`: Target temperature
- `E`: Error (positive = too cold)
- `Out`: Change in mixer position
- `Pos`: Current → new position (even integers)
- `P/I/D`: Individual control terms

### Critical Log Messages

| Message | Meaning | Action |
|---------|---------|--------|
| `!!! EMERGENCY !!!` | Emergency active | Check buffer heating |
| `Flow sensor: Invalid or missing value` | Sensor error | Check wiring |
| `PID: Invalid dt` | Timer problem | Restart script |
| `Position OK` | No action needed | Normal, no action |
| `PID: Anti-windup active` | Position at limit | Normal, integral clamped |

## 📄 License

This project is licensed under the MIT License - see [LICENSE](LICENSE) for details.
