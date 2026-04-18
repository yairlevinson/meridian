#!/usr/bin/env python3
"""
Write PX4 SITL parameters to parameters.bson.

Same params as GazeboLauncher.ensureSitlParams() — keeps Docker containers
and native Gazebo launches in sync.

Usage: python3 write-sitl-params.py /path/to/data/dir
"""

import struct
import sys
import os

# Resolve the active simulator model. The entrypoint may pass gz_<name> via
# PX4_SIM_MODEL, or only PX4_GZ_MODEL (bare name). SIH containers set
# PX4_SIM_MODEL directly (sihsim_*).
_raw_model = os.environ.get('PX4_SIM_MODEL') or os.environ.get('PX4_GZ_MODEL') or 'sihsim_airplane'
PX4_SIM_MODEL = _raw_model if _raw_model.startswith(('gz_', 'sihsim_')) else f'gz_{_raw_model}'
IS_SIH = PX4_SIM_MODEL.startswith('sihsim_')
IS_GZ = PX4_SIM_MODEL.startswith('gz_')

# SYS_AUTOSTART must match the simulator model — PX4 reverts the param at
# boot if the airframe doesn't match, so seeding the correct value avoids
# one wasted boot cycle.
SIM_MODEL_AUTOSTART = {
    'sihsim_quadx': 10040,
    'sihsim_airplane': 10041,
    'sihsim_xvert': 10042,
    'gz_x500': 4001,
    'gz_x500_depth': 4002,
    'gz_rc_cessna': 4003,
    'gz_standard_vtol': 4004,
    'gz_x500_vision': 4005,
    'gz_px4vision': 4006,
    'gz_advanced_plane': 4008,
    'gz_r1_rover': 4009,
    'gz_x500_mono_cam': 4010,
    'gz_lawnmower': 4011,
    # Meridian-custom composite model: advanced_plane + forward-facing camera.
    # Airframe file shipped in the Docker image at 4012_gz_advanced_plane_cam.
    'gz_advanced_plane_cam': 4012,
}

# Seeded only on first boot, so user airframe changes via MAVLink survive reboots.
SEED_ONLY_PARAMS = {}
if PX4_SIM_MODEL in SIM_MODEL_AUTOSTART:
    SEED_ONLY_PARAMS['SYS_AUTOSTART'] = ('int32', SIM_MODEL_AUTOSTART[PX4_SIM_MODEL])

# Per-airframe tuning seeds — written only on first boot, then user can adjust.
if PX4_SIM_MODEL in ('sihsim_airplane', 'gz_advanced_plane', 'gz_advanced_plane_cam', 'gz_rc_cessna'):
    SEED_ONLY_PARAMS.update({
        'FW_AIRSPD_TRIM': ('double', 90.0),
        'FW_AIRSPD_MAX': ('double', 100.0),
        'NAV_LOITER_RAD': ('double', 1200.0),
    })

# Overwritten every boot — health/connectivity requirements that must stay correct.
SITL_PARAMS = {
    # SYS_AUTOCONFIG=0: don't reset params on boot
    'SYS_AUTOCONFIG': ('int32', 0),

    # Circuit breakers for SITL
    'CBRK_SUPPLY_CHK': ('int32', 894281),  # disable battery check
    'CBRK_IO_SAFETY': ('int32', 22027),    # disable safety switch (matches official airframe)

    # MAVLink: broadcast to GCS port
    'MAV_0_BROADCAST': ('int32', 1),

    # Sensor calibration — SIH and Gazebo both use perfectly-aligned simulated
    # sensors with the same device IDs. Identity calibration makes preflight
    # pass without running a real calibration flow (otherwise UI reports
    # "needs calibration" and arming is denied).
    'CAL_ACC0_ID': ('int32', 1310988),
    'CAL_ACC0_XOFF': ('double', 0.0),
    'CAL_ACC0_YOFF': ('double', 0.0),
    'CAL_ACC0_ZOFF': ('double', 0.0),
    'CAL_ACC0_XSCALE': ('double', 1.0),
    'CAL_ACC0_YSCALE': ('double', 1.0),
    'CAL_ACC0_ZSCALE': ('double', 1.0),
    'CAL_ACC0_PRIO': ('int32', 75),
    'CAL_GYRO0_ID': ('int32', 1310988),
    'CAL_GYRO0_XOFF': ('double', 0.0),
    'CAL_GYRO0_YOFF': ('double', 0.0),
    'CAL_GYRO0_ZOFF': ('double', 0.0),
    'CAL_GYRO0_PRIO': ('int32', 75),
    'CAL_MAG0_ID': ('int32', 197388),
    'CAL_MAG0_XOFF': ('double', 0.0),
    'CAL_MAG0_YOFF': ('double', 0.0),
    'CAL_MAG0_ZOFF': ('double', 0.0),
    'CAL_MAG0_XSCALE': ('double', 1.0),
    'CAL_MAG0_YSCALE': ('double', 1.0),
    'CAL_MAG0_ZSCALE': ('double', 1.0),
    'CAL_MAG0_PRIO': ('int32', 75),
    'CAL_BARO0_ID': ('int32', 6620172),
    'CAL_BARO0_OFF': ('double', 0.0),
    'CAL_BARO0_PRIO': ('int32', 75),
}

if IS_SIH:
    # SIH-specific: zero sensor delay (default 110ms is for real hardware)
    # and SIH_LOC_* for home (SIH doesn't read PX4_HOME env).
    SITL_PARAMS.update({
        'EKF2_GPS_DELAY': ('double', 0.0),
        'SIH_LOC_LAT0': ('int32', 320800000),   # 32.08° N
        'SIH_LOC_LON0': ('int32', 347800000),   # 34.78° E
        'SIH_LOC_H0': ('double', 20.0),
    })

if IS_GZ:
    # Gazebo simulated motors don't publish esc_status with a valid arming
    # state or an armed/current/throttle signal matching the failure-detector
    # model, so FD_ESCS_EN + FD_ACT_EN trigger a false "ESC failure detected"
    # immediately after arming and failsafe-disarm. Disable those checks for
    # gz SITL. GPS/mag/EKF sensor tuning stays at PX4 defaults.
    SITL_PARAMS.update({
        'FD_ESCS_EN': ('int32', 0),
        'FD_ACT_EN': ('int32', 0),
    })

# Per-airframe sensor/EKF overrides.
if PX4_SIM_MODEL == 'sihsim_quadx':
    # Quad: SIH mag floods TIMEOUT spam; safe to disable since GPS heading
    # works once the quad spins up.
    SITL_PARAMS['EKF2_MAG_TYPE'] = ('int32', 5)  # NONE
elif PX4_SIM_MODEL in ('sihsim_airplane', 'gz_advanced_plane', 'gz_advanced_plane_cam', 'gz_rc_cessna'):
    # Plane sits stationary on the ground — without mag the EKF can't
    # initialise heading (GPS-derived heading needs motion), leading to
    # "Preflight Fail: Yaw estimate error". Force mag-on (heading-only).
    SITL_PARAMS['EKF2_MAG_TYPE'] = ('int32', 1)  # Heading-only


def read_bson_params(filepath):
    """Read PX4 parameters.bson into a dict."""
    params = {}
    with open(filepath, 'rb') as f:
        data = f.read()
    pos = 4  # skip BSON doc size
    while pos < len(data) - 1:
        type_byte = data[pos]
        if type_byte == 0:
            break
        pos += 1
        null_pos = data.index(0, pos)
        key = data[pos:null_pos].decode('utf-8')
        pos = null_pos + 1
        if type_byte == 0x10:  # int32
            value = struct.unpack_from('<i', data, pos)[0]
            pos += 4
            params[key] = ('int32', value)
        elif type_byte == 0x01:  # double
            value = struct.unpack_from('<d', data, pos)[0]
            pos += 8
            params[key] = ('double', value)
        else:
            break
    return params


def write_bson_params(filepath, params):
    """Write params dict to PX4 BSON format."""
    # Calculate size
    doc_size = 4 + 1  # header + trailing null
    for key, (typ, _) in params.items():
        doc_size += 1 + len(key.encode('utf-8')) + 1 + (4 if typ == 'int32' else 8)

    buf = bytearray(doc_size)
    struct.pack_into('<i', buf, 0, doc_size)
    pos = 4
    for key in sorted(params.keys()):
        typ, value = params[key]
        buf[pos] = 0x10 if typ == 'int32' else 0x01
        pos += 1
        key_bytes = key.encode('utf-8')
        buf[pos:pos + len(key_bytes)] = key_bytes
        pos += len(key_bytes)
        buf[pos] = 0
        pos += 1
        if typ == 'int32':
            struct.pack_into('<i', buf, pos, int(value))
            pos += 4
        else:
            struct.pack_into('<d', buf, pos, float(value))
            pos += 8
    buf[pos] = 0
    with open(filepath, 'wb') as f:
        f.write(buf)


def main():
    data_dir = sys.argv[1] if len(sys.argv) > 1 else '.'
    param_file = os.path.join(data_dir, 'parameters.bson')
    backup_file = os.path.join(data_dir, 'parameters_backup.bson')

    # Read existing params if present
    params = {}
    if os.path.exists(param_file):
        params = read_bson_params(param_file)

    # Seed-only params: write only if not already present, so runtime changes
    # via MAVLink (e.g. user switching airframe) survive container reboots.
    for key, val in SEED_ONLY_PARAMS.items():
        if key not in params:
            params[key] = val

    # Always-overwrite params (health/connectivity).
    params.update(SITL_PARAMS)

    # Write
    write_bson_params(param_file, params)
    write_bson_params(backup_file, params)
    print(f'[write-sitl-params] Wrote {len(params)} params to {param_file}')


if __name__ == '__main__':
    main()
