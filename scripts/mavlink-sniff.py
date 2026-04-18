#!/usr/bin/env python3
"""
MAVLink UDP sniffer — listens on a port and logs all traffic.
Sits as a proxy between QGC (port 14550) and the vehicle.

Usage:
  1. Stop Meridian so port 14550 is free
  2. Run: python3 scripts/mavlink-sniff.py
  3. Start QGC — it will connect through the proxy
  4. Use motor test in QGC, then Ctrl+C to stop

The script logs COMMAND_LONG messages with full parameter details.
"""

import sys
sys.path.insert(0, '/opt/homebrew/lib/python3.10/site-packages')

import socket
import time
from pymavlink.dialects.v20 import common as mavlink2

MAV_CMD_NAMES = {
    11: 'SET_MODE',
    22: 'NAV_TAKEOFF',
    176: 'DO_SET_MODE',
    187: 'DO_SET_ACTUATOR',
    209: 'DO_MOTOR_TEST',
    310: 'ACTUATOR_TEST',
    311: 'CONFIGURE_ACTUATOR',
    400: 'COMPONENT_ARM_DISARM',
    511: 'SET_MESSAGE_INTERVAL',
    512: 'REQUEST_MESSAGE',
}

def cmd_name(cmd_id):
    return MAV_CMD_NAMES.get(cmd_id, f'CMD_{cmd_id}')

def sniff():
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(('0.0.0.0', 14550))
    sock.settimeout(0.1)
    print(f'[sniff] Listening on UDP :14550')
    print(f'[sniff] Waiting for traffic... (start QGC now)')

    # Track endpoints
    vehicle_addr = None
    gcs_addr = None

    mav = mavlink2.MAVLink(None)
    mav.robust_parsing = True

    while True:
        try:
            data, addr = sock.recvfrom(4096)
        except socket.timeout:
            continue
        except KeyboardInterrupt:
            break

        ts = time.strftime('%H:%M:%S', time.localtime())

        try:
            msgs = mav.parse_buffer(data)
            if not msgs:
                continue
        except Exception:
            continue

        for msg in msgs:
            msg_type = msg.get_type()
            sysid = msg.get_srcSystem()
            compid = msg.get_srcComponent()

            # Identify vehicle vs GCS by sysid
            if sysid < 200 and sysid > 0:
                if vehicle_addr is None or vehicle_addr == addr:
                    vehicle_addr = addr
                    direction = 'VEHICLE→'
                    # Forward to GCS
                    if gcs_addr:
                        sock.sendto(data, gcs_addr)
                else:
                    gcs_addr = addr
                    direction = 'GCS→   '
                    # Forward to vehicle
                    if vehicle_addr:
                        sock.sendto(data, vehicle_addr)
            else:
                if gcs_addr is None:
                    gcs_addr = addr
                direction = 'GCS→   '
                if vehicle_addr:
                    sock.sendto(data, vehicle_addr)

            # Log interesting messages (skip noisy telemetry)
            if msg_type == 'COMMAND_LONG':
                cmd = msg.command
                print(f'{ts} {direction} {sysid}:{compid} COMMAND_LONG {cmd_name(cmd)}({cmd})'
                      f' p1={msg.param1} p2={msg.param2} p3={msg.param3}'
                      f' p4={msg.param4} p5={msg.param5} p6={msg.param6} p7={msg.param7}'
                      f' tgt={msg.target_system}:{msg.target_component}')
            elif msg_type == 'COMMAND_INT':
                cmd = msg.command
                print(f'{ts} {direction} {sysid}:{compid} COMMAND_INT {cmd_name(cmd)}({cmd})'
                      f' p1={msg.param1} p2={msg.param2} p3={msg.param3} p4={msg.param4}'
                      f' x={msg.x} y={msg.y} z={msg.z}'
                      f' tgt={msg.target_system}:{msg.target_component}')
            elif msg_type == 'COMMAND_ACK':
                print(f'{ts} {direction} {sysid}:{compid} COMMAND_ACK cmd={cmd_name(msg.command)}({msg.command}) result={msg.result}')
            elif msg_type == 'STATUSTEXT':
                print(f'{ts} {direction} {sysid}:{compid} STATUSTEXT [{msg.severity}] {msg.text}')
            elif msg_type in ('HEARTBEAT',):
                pass  # quiet
            elif msg_type not in (
                'ATTITUDE', 'ATTITUDE_QUATERNION', 'GLOBAL_POSITION_INT',
                'LOCAL_POSITION_NED', 'GPS_RAW_INT', 'SYS_STATUS',
                'SYSTEM_TIME', 'RC_CHANNELS', 'SERVO_OUTPUT_RAW',
                'VFR_HUD', 'HIGHRES_IMU', 'ALTITUDE', 'BATTERY_STATUS',
                'ESTIMATOR_STATUS', 'VIBRATION', 'SCALED_PRESSURE',
                'RAW_IMU', 'SCALED_IMU2', 'SCALED_IMU3',
                'ATTITUDE_TARGET', 'POSITION_TARGET_LOCAL_NED',
                'NAV_CONTROLLER_OUTPUT', 'EXTENDED_SYS_STATE',
                'GPS_STATUS', 'MISSION_CURRENT', 'HOME_POSITION',
                'PARAM_VALUE', 'TIMESYNC', 'PING',
                'OPEN_DRONE_ID_LOCATION', 'OPEN_DRONE_ID_BASIC_ID',
                'OPEN_DRONE_ID_SYSTEM',
            ):
                print(f'{ts} {direction} {sysid}:{compid} {msg_type}')

if __name__ == '__main__':
    sniff()
