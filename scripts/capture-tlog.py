#!/usr/bin/env python3
"""
Capture MAVLink telemetry logs (tlogs) from PX4 SITL by flying scripted scenarios.

Uses MAVSDK for reliable vehicle control (arm, takeoff, land, RTL) and pymavlink
for recording raw MAVLink traffic to tlog files.

Usage:
    # Start PX4 SITL first, then:
    python3 scripts/capture-tlog.py [--scenario arm-takeoff-land] [--port 14550]
    python3 scripts/capture-tlog.py --list          # list available scenarios
    python3 scripts/capture-tlog.py --scenario all   # run all scenarios

Output: test/fixtures/captures/<scenario>.tlog

Tlog format: repeated [8-byte uint64 timestamp_usec][raw mavlink frame]

Requirements: pip3 install mavsdk pymavlink
"""

import argparse
import asyncio
import os
import struct
import sys
import time
import threading
from pymavlink import mavutil
from mavsdk import System


FIXTURE_DIR = os.path.join(os.path.dirname(__file__), '..', 'test', 'fixtures', 'captures')


class TlogRecorder:
    """Records raw MAVLink bytes with timestamps to a tlog file."""

    def __init__(self, path: str):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        self.f = open(path, 'wb')
        self.count = 0
        self._lock = threading.Lock()

    def write(self, raw_bytes: bytes):
        ts = int(time.time() * 1e6)
        with self._lock:
            self.f.write(struct.pack('<Q', ts))
            self.f.write(raw_bytes)
            self.count += 1

    def close(self):
        self.f.close()
        print(f'  Recorded {self.count} messages')



class PymavRecorder:
    """Records MAVLink traffic using pymavlink connection."""

    def __init__(self, recorder: TlogRecorder, host: str, port: int):
        self.recorder = recorder
        self.host = host
        self.port = port
        self._running = False
        self._thread = None
        self.conn = None

    def start(self):
        self._running = True
        self.conn = mavutil.mavlink_connection(
            f'udpin:{self.host}:{self.port}', source_system=255, source_component=190
        )
        self._thread = threading.Thread(target=self._listen, daemon=True)
        self._thread.start()
        print(f'  Recording MAVLink via pymavlink on udp://{self.host}:{self.port}')

    def _listen(self):
        while self._running:
            try:
                msg = self.conn.recv_match(blocking=True, timeout=1)
                if msg is not None:
                    raw = msg.get_msgbuf()
                    if raw:
                        self.recorder.write(bytes(raw))
            except Exception:
                if self._running:
                    continue
                break

    def stop(self):
        self._running = False
        if self._thread:
            self._thread.join(timeout=2)


# ── MAVSDK-based scenarios ─────────────────────────────────

async def connect_mavsdk(port: int = 14540) -> System:
    """Connect MAVSDK to PX4 SITL."""
    drone = System()
    await drone.connect(system_address=f'udpin://0.0.0.0:{port}')

    print('  Waiting for MAVSDK connection...')
    async for state in drone.core.connection_state():
        if state.is_connected:
            print('  MAVSDK connected')
            break

    # Wait for global position estimate
    print('  Waiting for global position estimate...')
    async for health in drone.telemetry.health():
        if health.is_global_position_ok and health.is_home_position_ok:
            print('  Global position OK')
            break

    return drone


async def configure_for_sitl(drone: System):
    """Set PX4 parameters needed for scripted SITL arming."""
    print('  Configuring SITL params via MAVSDK...')
    params = [
        ('COM_ARMABLE', 1),       # Allow arming (PX4 v1.17+ defaults to 0 = safety mode)
        ('COM_RC_IN_MODE', 4),    # No RC required
        ('NAV_RCL_ACT', 0),      # No RC loss action
        ('NAV_DLL_ACT', 0),      # No datalink loss action
    ]
    for name, value in params:
        try:
            await drone.param.set_param_int(name, value)
            actual = await drone.param.get_param_int(name)
            print(f'    {name} = {actual}')
        except Exception as e:
            print(f'    {name}: {e}')

    # Wait for PX4 to process param changes and report armable
    print('  Waiting for vehicle to become armable...')
    deadline = asyncio.get_event_loop().time() + 30
    async for health in drone.telemetry.health():
        if health.is_armable:
            print('  Vehicle is armable')
            break
        if asyncio.get_event_loop().time() > deadline:
            print('  WARNING: Timed out waiting for armable, proceeding anyway')
            break
        await asyncio.sleep(0.5)


async def arm_vehicle(drone: System):
    """Arm the vehicle."""
    print('  Arming...')
    await drone.action.arm()
    print('  Armed!')


async def scenario_arm_takeoff_land_async(drone: System):
    """Arm → takeoff to 10m → hover 5s → land → wait for disarm."""
    await configure_for_sitl(drone)

    print('  Setting takeoff altitude...')
    await drone.action.set_takeoff_altitude(10)

    await arm_vehicle(drone)

    print('  Taking off...')
    await drone.action.takeoff()

    # Wait for altitude
    print('  Waiting for altitude...')
    async for position in drone.telemetry.position():
        if position.relative_altitude_m > 8:
            print(f'  Reached altitude: {position.relative_altitude_m:.1f}m')
            break

    # Hover
    print('  Hovering for 5s...')
    await asyncio.sleep(5)

    # Land
    print('  Landing...')
    await drone.action.land()

    # Wait for disarm
    print('  Waiting for landing/disarm...')
    async for armed in drone.telemetry.armed():
        if not armed:
            print('  Disarmed!')
            break

    await asyncio.sleep(3)


async def scenario_rtl_async(drone: System):
    """Arm → takeoff to 15m → hover → RTL → wait for land+disarm."""
    await configure_for_sitl(drone)

    print('  Setting takeoff altitude...')
    await drone.action.set_takeoff_altitude(15)

    await arm_vehicle(drone)

    print('  Taking off...')
    await drone.action.takeoff()

    print('  Waiting for altitude...')
    async for position in drone.telemetry.position():
        if position.relative_altitude_m > 12:
            print(f'  Reached altitude: {position.relative_altitude_m:.1f}m')
            break

    print('  Hovering for 3s...')
    await asyncio.sleep(3)

    print('  Commanding RTL...')
    await drone.action.return_to_launch()

    print('  Waiting for landing/disarm...')
    async for armed in drone.telemetry.armed():
        if not armed:
            print('  Disarmed!')
            break

    await asyncio.sleep(3)


async def scenario_gps_startup_async(drone: System):
    """Record the first 30s of telemetry — GPS fix progression, sensor init."""
    print('  Recording startup sequence for 30s...')
    await asyncio.sleep(30)


async def scenario_mode_changes_async(drone: System):
    """Cycle through several flight modes without arming."""
    modes = [
        ('Hold', drone.action.hold),
        ('Return to Launch', drone.action.return_to_launch),
        ('Land', drone.action.land),
    ]
    await asyncio.sleep(3)

    for name, action_fn in modes:
        print(f'  Setting mode: {name}')
        try:
            await action_fn()
        except Exception as e:
            print(f'    (expected error: {e})')
        await asyncio.sleep(2)

    await asyncio.sleep(3)


async def scenario_waypoint_mission_async(drone: System):
    """Upload a 4-waypoint mission, fly it, wait for completion.

    Covers MISSION_CURRENT, VFR_HUD (varying speeds), BATTERY_STATUS drain,
    plus richer GPS/attitude data during actual movement.
    """
    await configure_for_sitl(drone)

    from mavsdk.mission import MissionItem

    # Square pattern ~50m each side, 15m altitude
    home_lat = 47.397742
    home_lon = 8.545594
    offset = 0.0005  # ~50m

    waypoints = [
        MissionItem(home_lat + offset, home_lon, 15, 5, True, float('nan'), float('nan'),
                    MissionItem.CameraAction.NONE, float('nan'), float('nan'), float('nan'),
                    float('nan'), float('nan'), MissionItem.VehicleAction.NONE),
        MissionItem(home_lat + offset, home_lon + offset, 15, 5, True, float('nan'), float('nan'),
                    MissionItem.CameraAction.NONE, float('nan'), float('nan'), float('nan'),
                    float('nan'), float('nan'), MissionItem.VehicleAction.NONE),
        MissionItem(home_lat, home_lon + offset, 15, 5, True, float('nan'), float('nan'),
                    MissionItem.CameraAction.NONE, float('nan'), float('nan'), float('nan'),
                    float('nan'), float('nan'), MissionItem.VehicleAction.NONE),
        MissionItem(home_lat, home_lon, 15, 5, True, float('nan'), float('nan'),
                    MissionItem.CameraAction.NONE, float('nan'), float('nan'), float('nan'),
                    float('nan'), float('nan'), MissionItem.VehicleAction.NONE),
    ]

    print(f'  Uploading {len(waypoints)}-waypoint mission...')
    from mavsdk.mission import MissionPlan
    await drone.mission.upload_mission(MissionPlan(waypoints))

    await arm_vehicle(drone)

    print('  Starting mission...')
    await drone.mission.start_mission()

    print('  Waiting for mission completion...')
    async for progress in drone.mission.mission_progress():
        print(f'    Waypoint {progress.current}/{progress.total}')
        if progress.current == progress.total:
            break

    print('  Mission complete, landing...')
    await drone.action.land()

    print('  Waiting for landing/disarm...')
    async for armed in drone.telemetry.armed():
        if not armed:
            print('  Disarmed!')
            break

    await asyncio.sleep(3)


async def scenario_long_hover_async(drone: System):
    """Arm → takeoff to 20m → hover 30s → land.

    Extended hover captures steady-state telemetry: BATTERY_STATUS drain,
    SYS_STATUS sensor health, VIBRATION levels, HOME_POSITION,
    EXTENDED_SYS_STATE, and VFR_HUD.
    """
    await configure_for_sitl(drone)

    print('  Setting takeoff altitude...')
    await drone.action.set_takeoff_altitude(20)

    await arm_vehicle(drone)

    print('  Taking off...')
    await drone.action.takeoff()

    print('  Waiting for altitude...')
    async for position in drone.telemetry.position():
        if position.relative_altitude_m > 18:
            print(f'  Reached altitude: {position.relative_altitude_m:.1f}m')
            break

    print('  Hovering for 30s (capturing steady-state telemetry)...')
    await asyncio.sleep(30)

    print('  Landing...')
    await drone.action.land()

    print('  Waiting for landing/disarm...')
    async for armed in drone.telemetry.armed():
        if not armed:
            print('  Disarmed!')
            break

    await asyncio.sleep(3)


# ── Scenario registry ─────────────────────────────────────

SCENARIOS = {
    'arm-takeoff-land': ('Arm, takeoff, hover, land', scenario_arm_takeoff_land_async),
    'rtl': ('Arm, takeoff, RTL, land', scenario_rtl_async),
    'gps-startup': ('Record GPS fix progression on startup', scenario_gps_startup_async),
    'mode-changes': ('Cycle PX4 flight modes without arming', scenario_mode_changes_async),
    'waypoint-mission': ('Fly a 4-waypoint square mission', scenario_waypoint_mission_async),
    'long-hover': ('Extended hover for steady-state telemetry', scenario_long_hover_async),
}


async def run_scenario(name: str, desc: str, fn, recorder: TlogRecorder, record_port: int, mavsdk_port: int):
    """Run a single scenario with MAVSDK + pymavlink recording."""
    tlog_path = os.path.join(FIXTURE_DIR, f'{name}.tlog')
    print(f'\n{"="*60}')
    print(f'Scenario: {name} — {desc}')
    print(f'Output:   {tlog_path}')
    print(f'{"="*60}')

    # Start recording on the GCS port
    listener = PymavRecorder(recorder, '127.0.0.1', record_port)
    listener.start()

    try:
        # Give listener time to start receiving
        await asyncio.sleep(2)

        # Connect MAVSDK (uses its own gRPC → mavsdk_server → UDP connection)
        drone = await connect_mavsdk(mavsdk_port)

        # Run the scenario
        await fn(drone)

        print(f'  ✓ Scenario "{name}" complete')
    except Exception as e:
        print(f'  ✗ Scenario "{name}" failed: {e}')
        import traceback
        traceback.print_exc()
    finally:
        listener.stop()


def main():
    parser = argparse.ArgumentParser(description='Capture MAVLink tlogs from PX4 SITL')
    parser.add_argument('--scenario', default='arm-takeoff-land', help='Scenario to run (or "all")')
    parser.add_argument('--port', type=int, default=14550, help='UDP port to record MAVLink on (default: 14550)')
    parser.add_argument('--mavsdk-port', type=int, default=14540, help='MAVSDK UDP port (default: 14540)')
    parser.add_argument('--list', action='store_true', help='List available scenarios')
    args = parser.parse_args()

    if args.list:
        print('Available scenarios:')
        for name, (desc, _) in SCENARIOS.items():
            print(f'  {name:25s} {desc}')
        return

    to_run = list(SCENARIOS.keys()) if args.scenario == 'all' else [args.scenario]

    for name in to_run:
        if name not in SCENARIOS:
            print(f'Unknown scenario: {name}')
            print(f'Available: {", ".join(SCENARIOS.keys())}')
            sys.exit(1)

    for name in to_run:
        desc, fn = SCENARIOS[name]
        tlog_path = os.path.join(FIXTURE_DIR, f'{name}.tlog')
        recorder = TlogRecorder(tlog_path)
        try:
            asyncio.run(run_scenario(name, desc, fn, recorder, args.port, args.mavsdk_port))
        finally:
            recorder.close()

    print(f'\nCaptures saved to {os.path.abspath(FIXTURE_DIR)}/')


if __name__ == '__main__':
    main()
