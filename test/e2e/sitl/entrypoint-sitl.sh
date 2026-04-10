#!/bin/bash
# Entrypoint for meridian-px4-sitl (headless, no Gazebo).
#
# Starts MAVProxy to bridge PX4's internal UDP → external TCP,
# then launches PX4 SITL in foreground.
set -e

PX4_BUILD=/px4/build/px4_sitl_default
PX4_DATA="$PX4_BUILD/rootfs"

# Use rootfs if it has rcS, otherwise fall back to ROMFS
if [ ! -f "$PX4_DATA/etc/init.d-posix/rcS" ]; then
  PX4_DATA=/px4/ROMFS/px4fmu_common
fi

# Clean stale lock/socket files from previous runs
rm -f /tmp/px4_lock-* /tmp/px4-sock-*

# Inject SITL parameters (MAV_0_BROADCAST, EKF tuning, sensor cal, etc.)
# Write to both the data dir (first-boot source) and CWD (PX4's runtime location).
python3 /write-sitl-params.py "$PX4_DATA"
python3 /write-sitl-params.py /px4

# SIH_LOC_LAT0/LON0 (degE7 INT32) are set via BSON parameters.
# Unset PX4_HOME_LAT/LON so PX4's px4-rc.simulator doesn't override
# them with truncated decimal values (e.g. 32.08 → 32).
unset PX4_HOME_LAT PX4_HOME_LON PX4_HOME_ALT

# MAVProxy bridges PX4's internal UDP 14550 → TCP 5760 for external clients.
# --daemon runs in background; tcpin makes MAVProxy listen for connections.
python3 -m MAVProxy.mavproxy \
  --daemon \
  --master=udpin:127.0.0.1:14550 \
  --out=tcpin:0.0.0.0:5760 \
  2>&1 > /tmp/mavproxy.log &

# Give MAVProxy a moment to bind
sleep 1

# Run PX4 SITL in foreground
exec "$PX4_BUILD/bin/px4" \
  "$PX4_DATA" \
  -s etc/init.d-posix/rcS \
  -t /px4/test_data
