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

# Params that are SEEDED ONLY if not already set in parameters.bson.
# Letting these persist allows users to change airframe via MAVLink/Meridian
# and have the change survive container reboots.
SEED_ONLY_PARAMS = {
    # Airframe: SIH quadcopter (10040 = sihsim_quadx) as the initial default.
    # 4001 is a Gazebo airframe — using it with PX4_SIM_MODEL=none
    # causes PX4 to error "please install gz-garden".
    'SYS_AUTOSTART': ('int32', 10040),
}

# Must match the params in gazeboLauncher.ts SITL_PARAMS, plus sensor
# calibration needed for SIH to report healthy. These are overwritten on
# every boot since they're health/connectivity requirements.
SITL_PARAMS = {
    # SYS_AUTOCONFIG=0: don't reset params on boot
    'SYS_AUTOCONFIG': ('int32', 0),

    # EKF tuning for SITL
    'EKF2_MAG_TYPE': ('int32', 5),  # NONE — disable mag; SIH mag causes TIMEOUT spam
    # EKF2_GPS_DELAY=0: SIH has zero sensor delay (default 110ms is for real hardware).
    # PX4 docs explicitly recommend this for SIH-as-SITL.
    'EKF2_GPS_DELAY': ('double', 0.0),

    # SIH home position (Tel Aviv) — SIH uses these params, not PX4_HOME env var.
    # LAT0/LON0 are INT32 in degE7 format in PX4 v1.15.x.
    'SIH_LOC_LAT0': ('int32', 320800000),   # 32.08° N
    'SIH_LOC_LON0': ('int32', 347800000),   # 34.78° E
    'SIH_LOC_H0': ('double', 20.0),

    # Circuit breakers for SITL
    'CBRK_SUPPLY_CHK': ('int32', 894281),  # disable battery check
    'CBRK_IO_SAFETY': ('int32', 22027),    # disable safety switch (matches official airframe)

    # MAVLink: broadcast to GCS port
    'MAV_0_BROADCAST': ('int32', 1),

    # Sensor calibration — SIH simulated sensors are perfectly aligned,
    # so identity calibration values make them pass preflight checks.
    # Accelerometer 0
    'CAL_ACC0_ID': ('int32', 1310988),
    'CAL_ACC0_XOFF': ('double', 0.0),
    'CAL_ACC0_YOFF': ('double', 0.0),
    'CAL_ACC0_ZOFF': ('double', 0.0),
    'CAL_ACC0_XSCALE': ('double', 1.0),
    'CAL_ACC0_YSCALE': ('double', 1.0),
    'CAL_ACC0_ZSCALE': ('double', 1.0),
    'CAL_ACC0_PRIO': ('int32', 75),
    # Gyroscope 0
    'CAL_GYRO0_ID': ('int32', 1310988),
    'CAL_GYRO0_XOFF': ('double', 0.0),
    'CAL_GYRO0_YOFF': ('double', 0.0),
    'CAL_GYRO0_ZOFF': ('double', 0.0),
    'CAL_GYRO0_PRIO': ('int32', 75),
    # Magnetometer 0
    'CAL_MAG0_ID': ('int32', 197388),
    'CAL_MAG0_XOFF': ('double', 0.0),
    'CAL_MAG0_YOFF': ('double', 0.0),
    'CAL_MAG0_ZOFF': ('double', 0.0),
    'CAL_MAG0_XSCALE': ('double', 1.0),
    'CAL_MAG0_YSCALE': ('double', 1.0),
    'CAL_MAG0_ZSCALE': ('double', 1.0),
    'CAL_MAG0_PRIO': ('int32', 75),
    # Barometer 0
    'CAL_BARO0_ID': ('int32', 6620172),
    'CAL_BARO0_OFF': ('double', 0.0),
    'CAL_BARO0_PRIO': ('int32', 75),
}


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
