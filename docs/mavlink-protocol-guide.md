# MAVLink Protocol Guide: GCS-Vehicle Communication

This document describes the MAVLink message sequences between a ground control station (GCS) and MAVLink-based autopilots (ArduPilot/PX4). It details every message type, when it is sent, request-response correlations, timing, and retry behavior.

---

## Table of Contents

1. [MAVLink Message Structure](#1-mavlink-message-structure)
2. [Connection Establishment & Heartbeat](#2-connection-establishment--heartbeat)
3. [Data Stream Requests](#3-data-stream-requests)
4. [Telemetry Messages (Vehicle → GCS)](#4-telemetry-messages-vehicle--gcs)
5. [Command Protocol (COMMAND_LONG / COMMAND_ACK)](#5-command-protocol)
6. [Parameter Protocol](#6-parameter-protocol)
7. [Mission Protocol](#7-mission-protocol)
8. [Camera Protocol](#8-camera-protocol)
9. [Gimbal Control](#9-gimbal-control)
10. [Sensor Calibration](#10-sensor-calibration)
11. [RC Calibration](#11-rc-calibration)
12. [MAVLink FTP](#12-mavlink-ftp)
13. [ADS-B Traffic](#13-adsb-traffic)
14. [Message Signing](#14-message-signing)
15. [Packet Loss Detection](#15-packet-loss-detection)
16. [Timing Reference](#16-timing-reference)

---

## 1. MAVLink Message Structure

MAVLink is a lightweight binary protocol designed for communication with small unmanned vehicles. There are two versions of the protocol: MAVLink v1 and MAVLink v2. Modern systems use **MAVLink v2**, which adds extensions, message signing, and a wider message ID space.

### MAVLink v2 Packet Layout

```
 Byte:  0        1       2       3       4       5        6-8      9       10..N-1   N..N+1   (N+2..N+14)
      ┌────────┬───────┬───────┬───────┬───────┬────────┬────────┬───────┬─────────┬────────┬──────────────┐
      │  STX   │  LEN  │ INCOMPAT│COMPAT│  SEQ  │ SYSID  │ COMPID │ MSGID │ PAYLOAD │  CRC   │  SIGNATURE   │
      │  0xFD  │       │ FLAGS  │FLAGS  │       │        │        │(3 byt)│         │(2 byt) │  (optional)  │
      └────────┴───────┴───────┴───────┴───────┴────────┴────────┴───────┴─────────┴────────┴──────────────┘
```

| Byte Offset  | Size | Field                     | Description                                                                                                                                                                                                                                                              |
| ------------ | ---- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0            | 1    | **STX** (Start marker)    | `0xFD` for MAVLink v2 (`0xFE` for v1). Identifies the start of a new frame.                                                                                                                                                                                              |
| 1            | 1    | **LEN** (Payload length)  | Length of the payload section in bytes (0-255). Does not include header, CRC, or signature.                                                                                                                                                                              |
| 2            | 1    | **INCOMPAT_FLAGS**        | Incompatibility flags. If a receiver does not understand a set flag, it **must discard** the message. Bit 0 (`0x01`) = message is signed (signature appended).                                                                                                           |
| 3            | 1    | **COMPAT_FLAGS**          | Compatibility flags. If a receiver does not understand a set flag, it can still parse the message normally. Currently unused (always 0).                                                                                                                                 |
| 4            | 1    | **SEQ** (Sequence number) | Rolling counter 0-255, incremented per message sent by each component. Used to detect packet loss (see [Packet Loss Detection](#15-packet-loss-detection)).                                                                                                              |
| 5            | 1    | **SYSID** (System ID)     | Identifies the sending system (vehicle or GCS). Vehicles typically use 1-199, GCS uses 255. Each system on the network must have a unique ID.                                                                                                                            |
| 6            | 1    | **COMPID** (Component ID) | Identifies the sending component within a system. Common values: 1=autopilot, 100-105=cameras, 154=gimbal, 190=GCS/mission planner.                                                                                                                                      |
| 7-9          | 3    | **MSGID** (Message ID)    | 24-bit message identifier. Determines how the payload is interpreted. MAVLink v1 used only 1 byte (0-255); v2 extends this to 3 bytes (0-16,777,215), enabling a much larger message space.                                                                              |
| 10..10+LEN-1 | LEN  | **PAYLOAD**               | Message-specific data, serialized in little-endian byte order. The structure is defined by the MSGID. Fields are packed with no alignment padding.                                                                                                                       |
| 10+LEN       | 2    | **CRC** (Checksum)        | CRC-16/MCRF4XX over bytes 1 through end of payload, initialized with 0xFFFF. Includes an extra **CRC_EXTRA** byte (not transmitted) that is derived from the message definition — this acts as a schema check, ensuring sender and receiver agree on the message format. |
| 12+LEN       | 13   | **SIGNATURE** (optional)  | Present only if INCOMPAT_FLAGS bit 0 is set. See [Message Signing](#14-message-signing).                                                                                                                                                                                 |

### MAVLink v1 vs v2 Comparison

| Feature               | MAVLink v1            | MAVLink v2                  |
| --------------------- | --------------------- | --------------------------- |
| Start marker          | `0xFE`                | `0xFD`                      |
| Header size           | 6 bytes               | 10 bytes                    |
| Message ID size       | 1 byte (256 messages) | 3 bytes (16M messages)      |
| Incompatibility flags | N/A                   | 1 byte                      |
| Compatibility flags   | N/A                   | 1 byte                      |
| Message signing       | Not supported         | Optional (13 bytes)         |
| Payload truncation    | Not supported         | Trailing zero bytes omitted |
| Max packet size       | 263 bytes             | 280 bytes (without signing) |

### Key Design Principles

**Little-endian byte order:** All multi-byte fields in the payload are serialized in little-endian format, matching the native byte order of most microcontrollers (ARM, x86).

**Zero-extension truncation:** In MAVLink v2, trailing zero bytes in the payload are omitted during transmission. The receiver re-pads the payload to the full message length with zeros. This reduces bandwidth for messages with many optional or unused trailing fields.

**CRC_EXTRA (seed byte):** Each message definition has a CRC_EXTRA byte computed at compile time from the message's field names, types, and order. This byte is included in the CRC calculation but not transmitted. If the sender and receiver have different definitions for the same MSGID (e.g., due to version mismatch), the CRC will fail and the message is silently dropped. This prevents misinterpretation of fields.

**System/Component addressing:** MAVLink uses a flat 2-level addressing scheme:

- **System ID** identifies a vehicle or GCS on the network (1-254). By convention, vehicles use low IDs (1 for the first vehicle, 2 for the second, etc.) and GCS uses 255.
- **Component ID** identifies a subsystem within a system. A vehicle might have compid=1 (autopilot), compid=100 (camera), compid=154 (gimbal). This allows multiple components on the same system to communicate independently.
- Messages with `target_system=0` and/or `target_component=0` are **broadcast** — all matching systems/components should process them.

**Unreliable transport assumption:** MAVLink assumes the underlying transport (UDP, serial, radio link) is unreliable. Messages may be lost, duplicated, or arrive out of order. The protocol handles this through:

- Sequence numbers for loss detection
- Application-level timeouts and retries for critical operations (commands, mission upload, parameters)
- Idempotent design where possible

---

## 2. Connection Establishment & Heartbeat

The heartbeat is the foundation of MAVLink communication. It establishes the link, identifies each party, and serves as a keepalive.

### GCS Heartbeat (GCS → Vehicle)

The GCS sends a `HEARTBEAT` (msgid=0) at **1 Hz** to every connected link.

| Field           | Value                       |
| --------------- | --------------------------- |
| `type`          | `MAV_TYPE_GCS` (6)          |
| `autopilot`     | `MAV_AUTOPILOT_INVALID` (8) |
| `base_mode`     | 0                           |
| `custom_mode`   | 0                           |
| `system_status` | `MAV_STATE_ACTIVE` (4)      |

**GCS identity:** sysid=255, compid=190 (MAV_COMP_ID_MISSIONPLANNER).

- **UDP mode:** The GCS sends heartbeats to the PX4 SITL default port (127.0.0.1:18570) and to all previously-discovered sender addresses. PX4's GCS MAVLink instance only begins transmitting after receiving a packet, so this initial heartbeat is required to bootstrap the connection.
- **TCP mode:** The GCS sends heartbeats on each established TCP connection.

### Vehicle Heartbeat (Vehicle → GCS)

The vehicle sends `HEARTBEAT` at **1 Hz** (configurable on PX4 via `MAV_CMD_SET_MESSAGE_INTERVAL`).

| Field           | Meaning                                                              |
| --------------- | -------------------------------------------------------------------- |
| `type`          | Vehicle type (e.g., `MAV_TYPE_QUADROTOR`=2, `MAV_TYPE_FIXED_WING`=1) |
| `autopilot`     | `MAV_AUTOPILOT_ARDUPILOTMEGA` (3) or `MAV_AUTOPILOT_PX4` (12)        |
| `base_mode`     | Bitfield: armed flag (bit 7), custom mode flag (bit 0), etc.         |
| `custom_mode`   | Autopilot-specific flight mode number                                |
| `system_status` | `STANDBY`, `ACTIVE`, `CRITICAL`, `EMERGENCY`, etc.                   |

### Vehicle Discovery

When the GCS receives a `HEARTBEAT` with:

- `compid = 1` (autopilot component)
- `sysid < 200` (not another GCS)
- `sysid != 0` (not broadcast)

...it creates a new Vehicle instance for that sysid. This triggers:

1. Data stream requests (Section 2)
2. Parameter download (Section 5)

### Connection Loss Detection

The GCS monitors heartbeat reception per vehicle:

- **Heartbeat timeout:** 3500 ms — if no heartbeat received within this window, the vehicle is marked as having lost communication on that link.
- **Check interval:** 1000 ms polling.

---

## 3. Data Stream Requests

After discovering a vehicle, the GCS requests telemetry at specific rates. The mechanism differs between ArduPilot and PX4.

### ArduPilot: REQUEST_DATA_STREAM (msgid=66)

ArduPilot uses the legacy `REQUEST_DATA_STREAM` message:

```
GCS → Vehicle: REQUEST_DATA_STREAM
  target_system, target_component
  req_stream_id    = <stream group>
  req_message_rate = <Hz>
  start_stop       = 1 (start)
```

| Stream ID | Name     | Requested Rate | Messages Included                       |
| --------- | -------- | -------------- | --------------------------------------- |
| 6         | POSITION | 4 Hz           | GLOBAL_POSITION_INT, LOCAL_POSITION_NED |
| 10        | EXTRA1   | 10 Hz          | ATTITUDE, SIMSTATE                      |
| 11        | EXTRA2   | 4 Hz           | VFR_HUD                                 |

ArduPilot groups messages into numbered streams. Requesting a stream enables all messages in that group at the specified rate.

### PX4: MAV_CMD_SET_MESSAGE_INTERVAL (cmd=511)

PX4 uses `COMMAND_LONG` to configure individual message intervals:

```
GCS → Vehicle: COMMAND_LONG (msgid=76)
  command     = 511 (MAV_CMD_SET_MESSAGE_INTERVAL)
  param1      = <message_id>
  param2      = <interval_us>  (1,000,000 / Hz)
```

| Message ID | Message Name        | Requested Rate | Interval (us) |
| ---------- | ------------------- | -------------- | ------------- |
| 33         | GLOBAL_POSITION_INT | 4 Hz           | 250,000       |
| 30         | ATTITUDE            | 10 Hz          | 100,000       |
| 74         | VFR_HUD             | 4 Hz           | 250,000       |
| 1          | SYS_STATUS          | 2 Hz           | 500,000       |
| 24         | GPS_RAW_INT         | 2 Hz           | 500,000       |
| 0          | HEARTBEAT           | 1 Hz           | 1,000,000     |

Each request expects a `COMMAND_ACK` in response (see Section 4).

---

## 4. Telemetry Messages (Vehicle → GCS)

These messages flow continuously from the vehicle to the GCS at the rates configured in Section 2. No acknowledgment is required.

### Core Attitude & Navigation

| Message                 | ID  | Rate  | Key Fields                                                                         |
| ----------------------- | --- | ----- | ---------------------------------------------------------------------------------- |
| **HEARTBEAT**           | 0   | 1 Hz  | type, autopilot, base_mode (armed), custom_mode (flight mode), system_status       |
| **ATTITUDE**            | 30  | 10 Hz | roll, pitch, yaw (rad), rollspeed, pitchspeed, yawspeed (rad/s)                    |
| **GLOBAL_POSITION_INT** | 33  | 4 Hz  | lat, lon (degE7), alt (mm MSL), relative_alt (mm AGL), vx/vy/vz (cm/s), hdg (cdeg) |
| **VFR_HUD**             | 74  | 4 Hz  | airspeed, groundspeed (m/s), heading (deg), throttle (%), alt (m), climb (m/s)     |

### System Health

| Message            | ID  | Rate  | Key Fields                                                                                                                                                                                |
| ------------------ | --- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SYS_STATUS**     | 1   | 2 Hz  | onboard_control_sensors_present/enabled/health (bitmasks), load (permille), voltage_battery (mV), current_battery (cA), battery_remaining (%), drop_rate_comm (permille), errors_count1-4 |
| **GPS_RAW_INT**    | 24  | 2 Hz  | fix_type (0-6), lat, lon, alt, eph (HDOP cm), epv (VDOP cm), vel (cm/s), satellites_visible                                                                                               |
| **BATTERY_STATUS** | 147 | ~1 Hz | id, voltages[10] (mV), current_battery (cA), current_consumed (mAh), energy_consumed (hJ), battery_remaining (%), time_remaining (s)                                                      |
| **RADIO_STATUS**   | 109 | ~1 Hz | rssi, remrssi (0-254), txbuf (%), noise, remnoise, rxerrors, fixed                                                                                                                        |

### Extended Telemetry

| Message                | ID  | Typical Rate | Key Fields                                                   |
| ---------------------- | --- | ------------ | ------------------------------------------------------------ |
| **HOME_POSITION**      | 242 | On change    | latitude, longitude, altitude (degE7, mm)                    |
| **RC_CHANNELS**        | 65  | ~2 Hz        | chan1_raw..chan18_raw (us PWM), chancount, rssi              |
| **SERVO_OUTPUT_RAW**   | 36  | ~2 Hz        | port, servo1_raw..servo16_raw (us PWM)                       |
| **VIBRATION**          | 241 | ~1 Hz        | vibration_x/y/z (m/s^2), clipping_0/1/2 (counts)             |
| **WIND**               | 168 | ~1 Hz        | direction (deg), speed (m/s), speed_z (m/s) — ArduPilot only |
| **EXTENDED_SYS_STATE** | 245 | ~1 Hz        | vtol_state, landed_state                                     |
| **TERRAIN_REPORT**     | 136 | ~1 Hz        | lat, lon, terrain_height (m MSL), current_height (m AGL)     |
| **STATUSTEXT**         | 253 | Event-driven | severity (MAV_SEVERITY), text (50 chars max)                 |
| **MISSION_CURRENT**    | 42  | On change    | seq (current waypoint index)                                 |

---

## 5. Command Protocol

The GCS sends commands using `COMMAND_LONG` and expects `COMMAND_ACK` in response.

### COMMAND_LONG (msgid=76) — GCS → Vehicle

```
target_system      = vehicle sysid
target_component   = vehicle compid (usually 1)
command            = MAV_CMD_* enum value
confirmation       = 0 (first attempt), 1, 2, 3 (retries)
param1..param7     = command-specific parameters
```

### COMMAND_ACK (msgid=77) — Vehicle → GCS

```
command            = echoed MAV_CMD_* value (correlation key)
result             = MAV_RESULT enum:
                     0 = ACCEPTED
                     1 = TEMPORARILY_REJECTED
                     2 = DENIED
                     3 = UNSUPPORTED
                     4 = FAILED
                     5 = IN_PROGRESS
                     6 = CANCELLED
progress           = 0-100 (for IN_PROGRESS)
result_param2      = command-specific extra result
target_system      = GCS sysid (255)
target_component   = GCS compid (190)
```

### Retry Behavior

- **Timeout:** 1500 ms per attempt
- **Max retries:** 3 (confirmation field incremented: 0, 1, 2, 3)
- **IN_PROGRESS handling:** If the vehicle responds with `result=5` (IN_PROGRESS), the GCS resets the timeout and waits for the final result. This is common for long-running commands like calibration.
- **Queue:** Commands are serialized — only one command is in-flight at a time per vehicle. Additional commands queue behind the current one.

### Common Commands

#### Arm / Disarm

```
command = 400 (MAV_CMD_COMPONENT_ARM_DISARM)
param1  = 1.0 (arm) or 0.0 (disarm)
param2  = 0.0 (normal) or 21196.0 (force — bypasses pre-arm checks)
```

#### Takeoff

```
command = 22 (MAV_CMD_NAV_TAKEOFF)
param7  = altitude_m (target altitude in meters)
```

#### Return to Launch (RTL)

```
command = 20 (MAV_CMD_NAV_RETURN_TO_LAUNCH)
(no params)
```

#### Land

```
command = 21 (MAV_CMD_NAV_LAND)
(no params)
```

#### Change Flight Mode

```
command = 176 (MAV_CMD_DO_SET_MODE)
param1  = 1.0 (MAV_MODE_FLAG_CUSTOM_MODE_ENABLED)
param2  = mode_number (autopilot-specific)
```

#### Guided Goto (Reposition)

```
command = 192 (MAV_CMD_DO_REPOSITION)
param1  = -1.0 (default ground speed)
param2  = 1.0 (MAV_DO_REPOSITION_FLAGS_CHANGE_MODE — switch to guided)
param5  = latitude (deg)
param6  = longitude (deg)
param7  = altitude (m AMSL)
```

#### Pause / Continue

```
command = 252 (MAV_CMD_DO_PAUSE_CONTINUE)
param1  = 0.0 (pause) or 1.0 (continue)
```

#### Motor Test

```
command = 209 (MAV_CMD_DO_MOTOR_TEST)
param1  = motor_instance (0-based)
param2  = 0.0 (MOTOR_TEST_THROTTLE_PERCENT)
param3  = throttle_percent (0-100)
param4  = timeout_s
param5  = motor_count (number of motors)
param6  = test_order (0=default)
```

#### Servo Test

```
command = 183 (MAV_CMD_DO_SET_SERVO)
param1  = servo_instance (1-based output number)
param2  = PWM value (typically 1000-2000)
```

---

## 6. Parameter Protocol

Parameters are key-value pairs stored on the vehicle (e.g., PID gains, sensor calibration, feature toggles). The protocol has three operations: list (download all), read (single), and set.

### 5.1 Download All Parameters

```
                    GCS                              Vehicle
                     │                                  │
                     │  PARAM_REQUEST_LIST (msgid=21)   │
                     │  target_system, target_component │
                     │─────────────────────────────────>│
                     │                                  │
                     │  PARAM_VALUE (msgid=22)          │
                     │  paramId, paramValue, paramType  │
                     │  paramCount=N, paramIndex=0      │
                     │<─────────────────────────────────│
                     │                                  │
                     │  PARAM_VALUE                     │
                     │  paramIndex=1                    │
                     │<─────────────────────────────────│
                     │                                  │
                     │  ...                             │
                     │                                  │
                     │  PARAM_VALUE                     │
                     │  paramIndex=N-1                  │
                     │<─────────────────────────────────│
```

The vehicle sends all parameters as a burst of `PARAM_VALUE` messages. The GCS tracks which indices were received and requests missing ones individually.

### 5.2 Read Single Parameter (Retry for Missing)

```
GCS → Vehicle: PARAM_REQUEST_READ (msgid=20)
  target_system, target_component
  param_id     = "" (empty — use index)
  param_index  = <missing index>

Vehicle → GCS: PARAM_VALUE (msgid=22)
```

- **Retry timeout:** 3000 ms
- **Max retries:** 3 per missing parameter

### 5.3 Set Parameter

```
                    GCS                              Vehicle
                     │                                  │
                     │  PARAM_SET (msgid=23)            │
                     │  param_id, param_value,          │
                     │  param_type                      │
                     │─────────────────────────────────>│
                     │                                  │
                     │  PARAM_VALUE (msgid=22)          │
                     │  (echoed with actual value)      │
                     │<─────────────────────────────────│
```

The vehicle responds with a `PARAM_VALUE` confirming the new value. If the value differs from what was sent, the vehicle rejected or clamped the value.

- **Timeout:** 3000 ms for acknowledgment.

### Type Encoding

All parameter values are transmitted as `float32` on the wire, regardless of their actual type. Integer types (INT8, INT16, INT32, UINT8, UINT16, UINT32) are **bit-reinterpreted** (not cast) through a shared `Float32Array`/`Int32Array` buffer to preserve their exact bit pattern. The `param_type` field tells the receiver how to decode the float32 back to the original type.

---

## 7. Mission Protocol

The mission protocol transfers ordered lists of waypoints and commands between GCS and vehicle. There are three mission types (specified in the `mission_type` field):

| Value | Type                       | Purpose                     |
| ----- | -------------------------- | --------------------------- |
| 0     | `MAV_MISSION_TYPE_MISSION` | Navigation waypoints        |
| 1     | `MAV_MISSION_TYPE_FENCE`   | GeoFence boundaries         |
| 2     | `MAV_MISSION_TYPE_RALLY`   | Rally (safe landing) points |

### 6.1 Mission Download (Read from Vehicle)

```
                    GCS                              Vehicle
                     │                                  │
                     │  MISSION_REQUEST_LIST (msgid=43) │
                     │  target_system, target_component │
                     │  mission_type                    │
                     │─────────────────────────────────>│
                     │                                  │
                     │  MISSION_COUNT (msgid=44)        │
                     │  count=N, mission_type           │
                     │<─────────────────────────────────│
                     │                                  │
                     │  MISSION_REQUEST_INT (msgid=51)  │
                     │  seq=0, mission_type             │
                     │─────────────────────────────────>│
                     │                                  │
                     │  MISSION_ITEM_INT (msgid=73)     │
                     │  seq=0, frame, command,          │
                     │  param1-4, x(lat), y(lon), z(alt)│
                     │  current, autocontinue,          │
                     │  mission_type                    │
                     │<─────────────────────────────────│
                     │                                  │
                     │  MISSION_REQUEST_INT             │
                     │  seq=1                           │
                     │─────────────────────────────────>│
                     │                                  │
                     │  MISSION_ITEM_INT                │
                     │  seq=1                           │
                     │<─────────────────────────────────│
                     │                                  │
                     │  ... (repeat for seq 2..N-1)     │
                     │                                  │
                     │  MISSION_ACK (msgid=47)          │
                     │  type=0 (ACCEPTED), mission_type │
                     │─────────────────────────────────>│
```

The GCS drives the download by requesting items one at a time. After receiving the last item, the GCS sends `MISSION_ACK` to confirm completion.

**Note:** `MISSION_REQUEST_INT` (msgid=51) is preferred over the legacy `MISSION_REQUEST` (msgid=40). Similarly, `MISSION_ITEM_INT` (msgid=73) uses `int32` lat/lon (degE7) for better precision than `MISSION_ITEM` (msgid=39) which uses `float`.

### 6.2 Mission Upload (Write to Vehicle)

```
                    GCS                              Vehicle
                     │                                  │
                     │  MISSION_COUNT (msgid=44)        │
                     │  count=N, mission_type           │
                     │─────────────────────────────────>│
                     │                                  │
                     │  MISSION_REQUEST_INT (msgid=51)  │
                     │  seq=0, mission_type             │
                     │<─────────────────────────────────│
                     │                                  │
                     │  MISSION_ITEM_INT (msgid=73)     │
                     │  seq=0, frame, command,          │
                     │  param1-4, x, y, z,             │
                     │  current, autocontinue,          │
                     │  mission_type                    │
                     │─────────────────────────────────>│
                     │                                  │
                     │  MISSION_REQUEST_INT             │
                     │  seq=1                           │
                     │<─────────────────────────────────│
                     │                                  │
                     │  MISSION_ITEM_INT                │
                     │  seq=1                           │
                     │─────────────────────────────────>│
                     │                                  │
                     │  ... (repeat for seq 2..N-1)     │
                     │                                  │
                     │  MISSION_ACK (msgid=47)          │
                     │  type=0 (ACCEPTED), mission_type │
                     │<─────────────────────────────────│
```

The vehicle drives the upload by requesting items one at a time. After receiving the last item, the vehicle sends `MISSION_ACK`.

### 6.3 Mission Item Fields

| Field            | Description                                                                                                           |
| ---------------- | --------------------------------------------------------------------------------------------------------------------- |
| `seq`            | Sequence number (0-based index)                                                                                       |
| `frame`          | Coordinate frame (e.g., `MAV_FRAME_GLOBAL_RELATIVE_ALT`=3)                                                            |
| `command`        | MAV_CMD enum (e.g., `NAV_WAYPOINT`=16, `NAV_LOITER_UNLIM`=17, `NAV_RETURN_TO_LAUNCH`=20, `DO_SET_CAM_TRIGG_DIST`=206) |
| `current`        | 1 if this is the current target waypoint, 0 otherwise                                                                 |
| `autocontinue`   | 1 to auto-advance to next item on completion                                                                          |
| `param1..param4` | Command-specific parameters (e.g., hold time, acceptance radius, yaw angle)                                           |
| `x`              | Latitude (degE7 for INT variant)                                                                                      |
| `y`              | Longitude (degE7 for INT variant)                                                                                     |
| `z`              | Altitude (meters, interpretation depends on `frame`)                                                                  |

### 6.4 Mission Protocol State Machine

The protocol uses these states:

| State          | Meaning                                                           |
| -------------- | ----------------------------------------------------------------- |
| `Idle`         | No active transfer                                                |
| `ReadingCount` | Waiting for MISSION_COUNT after sending MISSION_REQUEST_LIST      |
| `ReadingItems` | Iteratively requesting and receiving items                        |
| `WritingCount` | Waiting for first MISSION_REQUEST_INT after sending MISSION_COUNT |
| `WritingItems` | Responding to MISSION_REQUEST_INT with items                      |
| `Error`        | Transfer failed                                                   |

**Timeouts & Retries:**

- **ACK timeout:** 1500 ms per step
- **Max retries:** 5 per step
- On timeout in `ReadingCount`: resend `MISSION_REQUEST_LIST`
- On timeout in `ReadingItems`: resend `MISSION_REQUEST_INT` for current seq
- On timeout in `WritingCount`: resend `MISSION_COUNT`
- On timeout in `WritingItems`: resend the last `MISSION_ITEM_INT`

### 6.5 Set Current Waypoint

```
GCS → Vehicle: MISSION_SET_CURRENT (msgid=41)
  target_system, target_component, seq

Vehicle → GCS: MISSION_CURRENT (msgid=42)
  seq (echoed or updated)
```

### 6.6 Clear Mission

```
GCS → Vehicle: MISSION_CLEAR_ALL (msgid=45)
  target_system, target_component, mission_type

Vehicle → GCS: MISSION_ACK (msgid=47)
  type=0 (ACCEPTED)
```

---

## 8. Camera Protocol

Camera communication targets components with `compid` 100-105 (MAV_COMP_ID_CAMERA through MAV_COMP_ID_CAMERA6).

### 7.1 Camera Discovery

When the GCS receives a `HEARTBEAT` from a camera component:

```
                    GCS                              Camera
                     │                                  │
                     │  HEARTBEAT from compid=100       │
                     │<─────────────────────────────────│
                     │                                  │
                     │  COMMAND_LONG                    │
                     │  cmd=512 (REQUEST_MESSAGE)       │
                     │  param1=259 (CAMERA_INFORMATION) │
                     │─────────────────────────────────>│
                     │                                  │
                     │  CAMERA_INFORMATION (msgid=259)  │
                     │  vendorName, modelName,          │
                     │  firmwareVersion, focalLength,   │
                     │  sensorSize, resolution, flags   │
                     │<─────────────────────────────────│
                     │                                  │
                     │  COMMAND_LONG                    │
                     │  cmd=512 (REQUEST_MESSAGE)       │
                     │  param1=260 (CAMERA_SETTINGS)    │
                     │─────────────────────────────────>│
                     │                                  │
                     │  CAMERA_SETTINGS (msgid=260)     │
                     │  modeId, zoomLevel, focusLevel   │
                     │<─────────────────────────────────│
                     │                                  │
                     │  COMMAND_LONG                    │
                     │  cmd=512 (REQUEST_MESSAGE)       │
                     │  param1=261 (STORAGE_INFORMATION)│
                     │─────────────────────────────────>│
                     │                                  │
                     │  STORAGE_INFORMATION (msgid=261) │
                     │  storageId, storageCount,        │
                     │  status, totalCapacity,          │
                     │  usedCapacity, availableCapacity │
                     │<─────────────────────────────────│
```

**Retry intervals:**

- Camera information: 2000 ms, up to 10 retries
- Camera settings: 1000 ms, up to 5 retries
- Storage information: 2000 ms, up to 5 retries

### 7.2 Camera Status Polling

After discovery, the GCS continuously polls capture status:

```
GCS → Camera: COMMAND_LONG
  cmd=512 (REQUEST_MESSAGE)
  param1=262 (CAMERA_CAPTURE_STATUS)

Camera → GCS: CAMERA_CAPTURE_STATUS (msgid=262)
  image_status, video_status, image_interval, recording_time_ms, available_capacity
```

**Polling intervals vary by state:**

- Idle: 5000 ms
- Capturing images: 1000 ms
- Recording video: 1500 ms

### 7.3 Camera Commands

| Command                 | ID    | Purpose         | Key Params                                             |
| ----------------------- | ----- | --------------- | ------------------------------------------------------ |
| `IMAGE_START_CAPTURE`   | 2000  | Take photo(s)   | p1=0 (all cameras), p2=interval_s (0=single), p3=count |
| `IMAGE_STOP_CAPTURE`    | 2001  | Stop timelapse  | —                                                      |
| `VIDEO_START_CAPTURE`   | 2500  | Start recording | p1=stream_id, p2=capture_mode                          |
| `VIDEO_STOP_CAPTURE`    | 2501  | Stop recording  | p1=stream_id                                           |
| `SET_CAMERA_MODE`       | 530   | Switch mode     | p1=mode_id (0=image, 1=video)                          |
| `RESET_CAMERA_SETTINGS` | 529   | Factory reset   | —                                                      |
| `STORAGE_FORMAT`        | 42501 | Format storage  | p1=storage_id                                          |

### 7.4 Asynchronous Camera Events

```
Camera → GCS: CAMERA_IMAGE_CAPTURED (msgid=263)
  time_boot_ms, lat, lon, alt, relative_alt
  image_index, capture_result (1=success, 0=fail)
  file_url (if available)
```

This is sent by the camera after each successful image capture, without a request from the GCS.

---

## 9. Gimbal Control

### 8.1 Gimbal Attitude (Vehicle → GCS)

```
Vehicle → GCS: GIMBAL_DEVICE_ATTITUDE_STATUS (msgid=285)
  target_system, target_component
  q[4]           = quaternion [w, x, y, z]
  angular_velocity_x/y/z (rad/s)
  flags
```

This is sent continuously by the gimbal/vehicle, typically at 10+ Hz.

### 8.2 Gimbal Pitch/Yaw Command (GCS → Vehicle)

```
GCS → Vehicle: COMMAND_LONG (msgid=76)
  command = 1000 (MAV_CMD_DO_GIMBAL_MANAGER_PITCHYAW)
  param1  = pitch (radians, negative = down)
  param2  = yaw (radians)
  param3  = pitch_rate (NaN = unused)
  param4  = yaw_rate (NaN = unused)
  param5  = flags = 2 (GIMBAL_MANAGER_FLAGS_YAW_LOCK)
  param7  = gimbal_device_id
```

---

## 10. Sensor Calibration

Calibration is initiated via `COMMAND_LONG` with `cmd=241` (MAV_CMD_PREFLIGHT_CALIBRATION). Different parameters select the sensor:

### 9.1 Calibration Initiation

| Sensor         | param1 | param2 | param3 | param5 | param6 | param7 |
| -------------- | ------ | ------ | ------ | ------ | ------ | ------ |
| Gyroscope      | 1      |        |        |        |        |        |
| Compass        |        | 1      |        |        |        |        |
| Barometer      |        |        | 1      |        |        |        |
| Accelerometer  |        |        |        | 1      |        |        |
| Level Horizon  |        |        |        | 2      |        |        |
| Accel (Simple) |        |        |        | 4      |        |        |
| CompassMot     |        |        |        |        | 1      |        |
| ESC            |        |        |        |        |        | 1      |

**Cancel calibration:** Send the same command with all params = 0.

### 9.2 Calibration Progress Messages

During compass calibration, the vehicle sends:

```
Vehicle → GCS: MAG_CAL_PROGRESS (msgid=191)
  compass_id, cal_mask, cal_status, attempt
  completion_pct (0-100)
  completion_mask (bitmask of orientations completed)
  direction_x/y/z (unit vector pointing where to sample next)
```

```
Vehicle → GCS: MAG_CAL_REPORT (msgid=192)
  compass_id, cal_status, autosaved, fitness
  ofs_x, ofs_y, ofs_z (offset calibration results)
  diag_x, diag_y, diag_z, offdiag_x, offdiag_y, offdiag_z
  orientation_confidence, old_orientation, new_orientation
```

For accelerometer and other calibrations, progress is communicated via `STATUSTEXT` (msgid=253) messages. The GCS parses keywords from the text to determine which orientation the vehicle is requesting:

- "level" → Level orientation
- "upside" → Inverted
- "nose down" → Nose down
- "nose up" → Nose up
- "left" → Left side
- "right" → Right side

---

## 11. RC Calibration

RC calibration is a GCS-side process that does not use a dedicated MAVLink protocol. Instead:

1. **Input:** The GCS reads `RC_CHANNELS` (msgid=65) messages, which provide raw PWM values (1000-2000 typical) for all 18 channels at ~2 Hz.
2. **Processing:** The user moves each stick to extremes. The GCS records min/max/center for each channel.
3. **Output:** Calibration values are written back as parameters via `PARAM_SET`:
   - `RC1_MIN`, `RC1_MAX`, `RC1_TRIM` (for channel 1)
   - `RC2_MIN`, `RC2_MAX`, `RC2_TRIM` (for channel 2)
   - ... and so on for each channel.

---

## 12. MAVLink FTP

MAVLink FTP provides file system access on the vehicle, transported inside `FILE_TRANSFER_PROTOCOL` (msgid=110). Each message contains a 251-byte payload with a structured header.

### FTP Payload Structure

```
| Offset | Size | Field         | Description                    |
|--------|------|---------------|--------------------------------|
| 0      | 2    | seq_number    | Sequence for ACK correlation   |
| 2      | 1    | session       | Session handle (from Open)     |
| 3      | 1    | opcode        | Operation (see below)          |
| 4      | 1    | size          | Data length in this payload    |
| 5      | 1    | req_opcode    | Opcode being ACK'd/NAK'd      |
| 6      | 1    | burst_complete| 1 if burst read is done        |
| 7      | 1    | padding       |                                |
| 8      | 4    | offset        | File offset for R/W ops        |
| 12     | 239  | data          | Payload data                   |
```

### FTP Opcodes

| Opcode | Name           | Direction   | Purpose                      |
| ------ | -------------- | ----------- | ---------------------------- |
| 0      | NONE           | —           | No-op                        |
| 1      | TERMINATE      | GCS→Vehicle | Close session                |
| 2      | RESET          | GCS→Vehicle | Reset all sessions           |
| 3      | LIST_DIRECTORY | GCS→Vehicle | List directory contents      |
| 4      | OPEN_FILE_RO   | GCS→Vehicle | Open file for reading        |
| 5      | READ_FILE      | GCS→Vehicle | Read data from open file     |
| 6      | CREATE_FILE    | GCS→Vehicle | Create/open file for writing |
| 7      | WRITE_FILE     | GCS→Vehicle | Write data to open file      |
| 8      | REMOVE_FILE    | GCS→Vehicle | Delete file                  |
| 128    | ACK            | Vehicle→GCS | Success response             |
| 129    | NAK            | Vehicle→GCS | Error response               |

### File Download Sequence

```
                    GCS                              Vehicle
                     │                                  │
                     │  OPEN_FILE_RO                    │
                     │  data="/path/to/file\0"          │
                     │─────────────────────────────────>│
                     │                                  │
                     │  ACK                             │
                     │  session=S, size=4               │
                     │  data=<fileSize as uint32>       │
                     │<─────────────────────────────────│
                     │                                  │
                     │  READ_FILE                       │
                     │  session=S, offset=0             │
                     │─────────────────────────────────>│
                     │                                  │
                     │  ACK                             │
                     │  data=<up to 239 bytes>          │
                     │<─────────────────────────────────│
                     │                                  │
                     │  READ_FILE                       │
                     │  session=S, offset=239           │
                     │─────────────────────────────────>│
                     │                                  │
                     │  ...repeat until...              │
                     │                                  │
                     │  NAK                             │
                     │  data=5 (EOF)                    │
                     │<─────────────────────────────────│
                     │                                  │
                     │  TERMINATE                       │
                     │  session=S                       │
                     │─────────────────────────────────>│
                     │                                  │
                     │  ACK                             │
                     │<─────────────────────────────────│
```

### File Upload Sequence

```
                    GCS                              Vehicle
                     │                                  │
                     │  CREATE_FILE                     │
                     │  data="/path/to/file\0"          │
                     │─────────────────────────────────>│
                     │                                  │
                     │  ACK                             │
                     │  session=S                       │
                     │<─────────────────────────────────│
                     │                                  │
                     │  WRITE_FILE                      │
                     │  session=S, offset=0             │
                     │  data=<up to 239 bytes>          │
                     │─────────────────────────────────>│
                     │                                  │
                     │  ACK                             │
                     │<─────────────────────────────────│
                     │                                  │
                     │  ... repeat for all chunks ...   │
                     │                                  │
                     │  TERMINATE                       │
                     │  session=S                       │
                     │─────────────────────────────────>│
                     │                                  │
                     │  ACK                             │
                     │<─────────────────────────────────│
```

### FTP Error Codes

| Code | Name            | Meaning                      |
| ---- | --------------- | ---------------------------- |
| 0    | NONE            | No error                     |
| 1    | FAIL            | Generic failure              |
| 2    | FILE_NOT_FOUND  | File/path not found          |
| 3    | INVALID_SESSION | Bad session handle           |
| 4    | NO_SESSIONS     | No sessions available        |
| 5    | EOF             | End of file reached          |
| 6    | UNKNOWN_COMMAND | Opcode not supported         |
| 7    | FILE_EXISTS     | File already exists (create) |
| 8    | FILE_PROTECTED  | Permission denied            |

**Retry:** 2000 ms timeout, 3 max retries per operation.

---

## 13. ADS-B Traffic

ADS-B (Automatic Dependent Surveillance-Broadcast) messages report nearby aircraft detected by the vehicle's ADS-B receiver.

```
Vehicle → GCS: ADSB_VEHICLE (msgid=246)
  ICAO_address     = 24-bit transponder ID
  lat, lon         = position (degE7)
  altitude         = altitude (mm MSL)
  heading          = heading (cdeg, 0-35999)
  hor_velocity     = horizontal speed (cm/s)
  ver_velocity     = vertical speed (cm/s)
  callsign         = 9-char null-terminated string
  squawk           = transponder squawk code
  altitude_type    = 0=pressure, 1=geometric
  flags            = validity bitmask
```

- Messages arrive at the vehicle's ADS-B update rate (varies by traffic).
- The GCS tracks vehicles by ICAO address.
- **Stale timeout:** Vehicles not updated for 60 seconds are removed.
- **Cleanup interval:** Checked every 10 seconds.

---

## 14. Message Signing

MAVLink v2 supports optional message signing using SHA-256 HMAC with a 6-byte truncated signature.

### Signing Fields (appended to MAVLink v2 messages)

| Field       | Size    | Description                                           |
| ----------- | ------- | ----------------------------------------------------- |
| `link_id`   | 1 byte  | Identifies the link for timestamp tracking            |
| `timestamp` | 6 bytes | 48-bit, units of 10 microseconds since 2015-01-01 UTC |
| `signature` | 6 bytes | First 6 bytes of SHA-256 HMAC                         |

### HMAC Input

```
SHA-256(secret_key[32] || header[10] || payload[N] || CRC[2] || link_id[1] || timestamp[6])
```

The 32-byte secret key must be pre-shared between GCS and vehicle. Signing is negotiated per-link.

---

## 15. Packet Loss Detection

Each MAVLink v2 message includes an 8-bit sequence number (0-255, wrapping). The GCS tracks the last sequence number seen per (sysid, compid) pair on each channel.

```
expected_seq = (last_seq + 1) & 0xFF
if received_seq != expected_seq:
    lost = (received_seq - expected_seq) & 0xFF
    total_loss += lost
```

This provides per-link, per-component loss statistics. The GCS exposes `lossPercent = totalLoss / (totalLoss + totalReceived) * 100`.

---

## 16. Timing Reference

| Operation                    | Interval / Timeout | Notes                    |
| ---------------------------- | ------------------ | ------------------------ |
| GCS heartbeat                | 1000 ms            | Sent to all links        |
| Heartbeat loss detection     | 3500 ms            | Per vehicle per link     |
| Comm loss check              | 1000 ms            | Polling interval         |
| IPC delta broadcast          | 33 ms (~30 Hz)     | Main→Renderer state push |
| COMMAND_LONG timeout         | 1500 ms            | Per attempt              |
| COMMAND_LONG max retries     | 3                  | confirmation=0,1,2,3     |
| Mission step timeout         | 1500 ms            | Per request/response     |
| Mission max retries          | 5                  | Per step                 |
| Parameter download retry     | 3000 ms            | Per missing param        |
| Parameter max retries        | 3                  | Per missing param        |
| Parameter set timeout        | 3000 ms            | Waiting for echo         |
| FTP operation timeout        | 2000 ms            | Per request              |
| FTP max retries              | 3                  | Per operation            |
| ADS-B stale timeout          | 60,000 ms          | Remove unheard traffic   |
| ADS-B cleanup interval       | 10,000 ms          | Sweep frequency          |
| Camera info request          | 2000 ms interval   | Up to 10 retries         |
| Camera settings request      | 1000 ms interval   | Up to 5 retries          |
| Camera storage request       | 2000 ms interval   | Up to 5 retries          |
| Camera status poll (idle)    | 5000 ms            | Normal polling           |
| Camera status poll (capture) | 1000 ms            | During image capture     |
| Camera status poll (record)  | 1500 ms            | During video record      |

---

## Appendix: Message ID Quick Reference

| ID  | Message                       | Direction | Category              |
| --- | ----------------------------- | --------- | --------------------- |
| 0   | HEARTBEAT                     | Both      | Connection            |
| 1   | SYS_STATUS                    | V→G       | Telemetry             |
| 20  | PARAM_REQUEST_READ            | G→V       | Parameters            |
| 21  | PARAM_REQUEST_LIST            | G→V       | Parameters            |
| 22  | PARAM_VALUE                   | V→G       | Parameters            |
| 23  | PARAM_SET                     | G→V       | Parameters            |
| 24  | GPS_RAW_INT                   | V→G       | Telemetry             |
| 30  | ATTITUDE                      | V→G       | Telemetry             |
| 33  | GLOBAL_POSITION_INT           | V→G       | Telemetry             |
| 36  | SERVO_OUTPUT_RAW              | V→G       | Telemetry             |
| 39  | MISSION_ITEM                  | Both      | Mission (legacy)      |
| 40  | MISSION_REQUEST               | V→G       | Mission (legacy)      |
| 41  | MISSION_SET_CURRENT           | G→V       | Mission               |
| 42  | MISSION_CURRENT               | V→G       | Mission               |
| 43  | MISSION_REQUEST_LIST          | G→V       | Mission               |
| 44  | MISSION_COUNT                 | Both      | Mission               |
| 45  | MISSION_CLEAR_ALL             | G→V       | Mission               |
| 47  | MISSION_ACK                   | Both      | Mission               |
| 51  | MISSION_REQUEST_INT           | Both      | Mission               |
| 65  | RC_CHANNELS                   | V→G       | Telemetry             |
| 66  | REQUEST_DATA_STREAM           | G→V       | Stream Config         |
| 73  | MISSION_ITEM_INT              | Both      | Mission               |
| 74  | VFR_HUD                       | V→G       | Telemetry             |
| 76  | COMMAND_LONG                  | G→V       | Commands              |
| 77  | COMMAND_ACK                   | V→G       | Commands              |
| 109 | RADIO_STATUS                  | V→G       | Telemetry             |
| 110 | FILE_TRANSFER_PROTOCOL        | Both      | FTP                   |
| 136 | TERRAIN_REPORT                | V→G       | Telemetry             |
| 147 | BATTERY_STATUS                | V→G       | Telemetry             |
| 168 | WIND                          | V→G       | Telemetry (ArduPilot) |
| 191 | MAG_CAL_PROGRESS              | V→G       | Calibration           |
| 192 | MAG_CAL_REPORT                | V→G       | Calibration           |
| 241 | VIBRATION                     | V→G       | Telemetry             |
| 242 | HOME_POSITION                 | V→G       | Telemetry             |
| 245 | EXTENDED_SYS_STATE            | V→G       | Telemetry             |
| 246 | ADSB_VEHICLE                  | V→G       | Traffic               |
| 253 | STATUSTEXT                    | V→G       | Diagnostics           |
| 259 | CAMERA_INFORMATION            | V→G       | Camera                |
| 260 | CAMERA_SETTINGS               | V→G       | Camera                |
| 261 | STORAGE_INFORMATION           | V→G       | Camera                |
| 262 | CAMERA_CAPTURE_STATUS         | V→G       | Camera                |
| 263 | CAMERA_IMAGE_CAPTURED         | V→G       | Camera                |
| 285 | GIMBAL_DEVICE_ATTITUDE_STATUS | V→G       | Gimbal                |

_V→G = Vehicle to GCS, G→V = GCS to Vehicle, Both = bidirectional_
