# Parse MAVLink from pcapng

Extract and decode MAVLink v2 messages from a Wireshark pcapng capture file.

## Usage

Given a pcapng file path, run this Python script via Bash to extract MAVLink messages:

```bash
python3 << 'PYEOF'
import struct, subprocess, sys

PCAP_FILE = "$PCAP_FILE"  # Replace with actual path

result = subprocess.run(
    ['tshark', '-r', PCAP_FILE,
     '-Y', 'udp.port == 14550',
     '-T', 'fields', '-e', 'data', '-e', 'frame.time_relative'],
    capture_output=True, text=True
)

MSG_NAMES = {
    0: 'HEARTBEAT', 1: 'SYS_STATUS', 2: 'SYSTEM_TIME', 4: 'PING',
    22: 'PARAM_VALUE', 24: 'GPS_RAW_INT', 25: 'GPS_STATUS',
    29: 'SCALED_PRESSURE', 30: 'ATTITUDE', 31: 'ATTITUDE_QUATERNION',
    32: 'LOCAL_POSITION_NED', 33: 'GLOBAL_POSITION_INT',
    36: 'SERVO_OUTPUT_RAW', 42: 'MISSION_CURRENT', 43: 'MISSION_REQUEST',
    44: 'MISSION_COUNT', 47: 'MISSION_ACK', 51: 'MISSION_REQUEST_INT',
    62: 'NAV_CONTROLLER_OUTPUT', 65: 'RC_CHANNELS', 73: 'MISSION_ITEM_INT',
    74: 'VFR_HUD', 76: 'COMMAND_LONG', 77: 'COMMAND_ACK',
    82: 'SET_ATTITUDE_TARGET', 83: 'ATTITUDE_TARGET',
    85: 'POSITION_TARGET_LOCAL_NED', 105: 'HIGHRES_IMU',
    110: 'FILE_TRANSFER_PROTOCOL', 141: 'ALTITUDE',
    147: 'BATTERY_STATUS', 148: 'AUTOPILOT_VERSION',
    230: 'ESTIMATOR_STATUS', 241: 'VIBRATION', 245: 'EXTENDED_SYS_STATE',
    253: 'STATUSTEXT', 259: 'CAMERA_INFORMATION', 260: 'CAMERA_SETTINGS',
    261: 'STORAGE_INFORMATION', 262: 'CAMERA_CAPTURE_STATUS',
    263: 'CAMERA_IMAGE_CAPTURED', 280: 'GIMBAL_DEVICE_ATTITUDE_STATUS',
    281: 'GIMBAL_MANAGER_STATUS', 310: 'ACTUATOR_TEST',
    380: 'OPEN_DRONE_ID_SYSTEM', 395: 'COMPONENT_INFORMATION',
    397: 'COMPONENT_METADATA', 410: 'PLAY_TUNE_V2',
    411: 'SUPPORTED_TUNES', 512: 'REQUEST_MESSAGE',
    12901: 'OPEN_DRONE_ID_LOCATION',
}

OP_NAMES = {
    0:'None', 1:'TermSession', 2:'ResetSessions', 3:'ListDir',
    4:'OpenFileRO', 5:'ReadFile', 6:'CreateFile', 7:'WriteFile',
    8:'RemoveFile', 9:'CreateDir', 10:'RemoveDir', 11:'OpenFileWO',
    12:'TruncFile', 13:'Rename', 14:'CalcFileCRC32',
    128:'Ack', 129:'Nak',
}

NAK_CODES = {
    0:'None', 1:'Fail', 2:'FailErrno', 3:'InvalidDataSize',
    4:'InvalidSession', 5:'NoSessionsAvail', 6:'EOF',
    7:'UnknownCommand', 8:'FileExists', 9:'FileProtected',
    10:'FileNotFound',
}

# High-frequency messages to suppress by default
QUIET = {0, 1, 2, 24, 30, 31, 32, 33, 36, 65, 74, 82, 83, 85, 105, 141, 147, 230, 241}

for line in result.stdout.strip().split('\n'):
    parts = line.split('\t')
    if len(parts) < 2: continue
    hexdata, time_rel = parts[0], parts[1]
    if not hexdata: continue
    data = bytes.fromhex(hexdata)

    i = 0
    while i < len(data):
        if data[i] != 0xFD:
            i += 1
            continue
        if i + 10 > len(data): break
        payload_len = data[i+1]
        incompat = data[i+2]
        sysid = data[i+5]
        compid = data[i+6]
        msgid = data[i+7] | (data[i+8] << 8) | (data[i+9] << 16)
        payload = data[i+10:i+10+payload_len]
        frame_end = i + 10 + payload_len + 2
        if incompat & 0x01: frame_end += 13

        name = MSG_NAMES.get(msgid, f'MSG_{msgid}')

        # Skip high-frequency telemetry unless analyzing those specifically
        if msgid not in QUIET:
            line_out = f"[{time_rel}] {sysid}:{compid} {name}({msgid})"

            # COMMAND_LONG (76)
            if msgid == 76 and len(payload) >= 33:
                command = struct.unpack_from('<H', payload, 28)[0]
                target_sys, target_comp = payload[30], payload[31]
                params = [struct.unpack_from('<f', payload, j*4)[0] for j in range(7)]
                pstr = ' '.join(f'p{j+1}={params[j]}' for j in range(7) if params[j] != 0)
                line_out += f" cmd={command} target={target_sys}:{target_comp} {pstr}"

            # COMMAND_ACK (77)
            elif msgid == 77 and len(payload) >= 3:
                command = struct.unpack_from('<H', payload, 0)[0]
                res = payload[2]
                RES_NAMES = {0:'ACCEPTED', 1:'TEMPORARILY_REJECTED', 2:'DENIED',
                             3:'UNSUPPORTED', 4:'FAILED', 5:'IN_PROGRESS'}
                line_out += f" cmd={command} result={RES_NAMES.get(res, res)}"

            # FILE_TRANSFER_PROTOCOL (110)
            elif msgid == 110 and len(payload) >= 15:
                ftp = payload[3:]
                if len(ftp) >= 12:
                    seq_num = struct.unpack_from('<H', ftp, 0)[0]
                    opcode, size, req_opcode = ftp[3], ftp[4], ftp[5]
                    offset = struct.unpack_from('<I', ftp, 8)[0]
                    ftp_data = ftp[12:12+size]
                    op = OP_NAMES.get(opcode, f'Op{opcode}')
                    line_out += f" {op} seq={seq_num} size={size} offset={offset}"
                    if opcode in (3, 4, 6, 11) and size > 0:
                        path = ftp_data.decode('utf-8', errors='replace').rstrip('\x00')
                        line_out += f" path={path}"
                    elif opcode == 128 and req_opcode == 4 and len(ftp_data) >= 4:
                        fsz = struct.unpack_from('<I', ftp_data, 0)[0]
                        line_out += f" file_size={fsz}"
                    elif opcode == 128 and req_opcode == 5:
                        if len(ftp_data) >= 2 and ftp_data[0] == 0x1f and ftp_data[1] == 0x8b:
                            line_out += " (gzipped)"
                        else:
                            line_out += f" data={ftp_data[:60].decode('utf-8', errors='replace')}"
                    elif opcode == 129:
                        err = ftp_data[0] if ftp_data else -1
                        line_out += f" err={NAK_CODES.get(err, err)} reqOp={OP_NAMES.get(req_opcode, req_opcode)}"

            # COMPONENT_METADATA (397)
            elif msgid == 397 and len(payload) > 4:
                uri = payload[4:104].decode('utf-8', errors='replace').replace('\x00','').strip()
                line_out += f" uri={uri}"

            # COMPONENT_INFORMATION (395)
            elif msgid == 395 and len(payload) > 4:
                uri = payload[4:104].decode('utf-8', errors='replace').replace('\x00','').strip()
                line_out += f" generalMetadataUri={uri}"

            # PARAM_VALUE (22)
            elif msgid == 22 and len(payload) >= 25:
                param_val = struct.unpack_from('<f', payload, 0)[0]
                param_count = struct.unpack_from('<H', payload, 4)[0]
                param_idx = struct.unpack_from('<H', payload, 6)[0]
                param_id = payload[8:24].decode('utf-8', errors='replace').rstrip('\x00')
                line_out += f" {param_id}={param_val} [{param_idx}/{param_count}]"

            # STATUSTEXT (253)
            elif msgid == 253 and len(payload) >= 2:
                severity = payload[0]
                text = payload[1:51].decode('utf-8', errors='replace').rstrip('\x00')
                line_out += f" sev={severity} {text}"

            print(line_out)

        i = max(frame_end, i + 1)
PYEOF
```

## Steps

1. Replace `$PCAP_FILE` with the user-provided pcapng file path
2. Adjust the UDP port filter if MAVLink is on a different port (default: 14550)
3. To include high-frequency messages, remove the `if msgid not in QUIET` check
4. To filter for specific messages only, modify the QUIET set or add an allowlist

## Notes

- Requires `tshark` (part of Wireshark) installed on the system
- Parses MAVLink v2 frames (start byte 0xFD) including signed packets
- Decodes COMMAND_LONG params, COMMAND_ACK results, FTP operations, component metadata URIs, PARAM_VALUE, and STATUSTEXT
- Suppresses high-frequency telemetry (attitude, GPS, heartbeat, etc.) by default for readability
