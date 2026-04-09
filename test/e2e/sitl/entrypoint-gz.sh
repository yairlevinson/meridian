#!/bin/bash
# Entrypoint for meridian-px4-gz (PX4 + Gazebo Harmonic).
#
# Launches Gazebo headless, then PX4 SITL, with MAVProxy bridging
# PX4's internal UDP to external TCP. Optionally starts a GStreamer
# video bridge for camera-equipped models.
set -e

PX4_BUILD=/px4/build/px4_sitl_default

# Use rootfs if available (has rcS + gz_env.sh)
PX4_DATA="$PX4_BUILD/rootfs"
if [ ! -f "$PX4_DATA/etc/init.d-posix/rcS" ]; then
  PX4_DATA=/px4/ROMFS/px4fmu_common
fi

# Clean stale state from previous runs
rm -f /tmp/px4_lock-* /tmp/px4-sock-*
rm -f "$PX4_DATA/dataman"

# Inject SITL parameters (MAV_0_BROADCAST, EKF tuning, sensor cal, etc.)
python3 /write-sitl-params.py "$PX4_DATA"
python3 /write-sitl-params.py /px4

# Set home position
export PX4_HOME="${PX4_HOME_LAT},${PX4_HOME_LON},${PX4_HOME_ALT},0"

# Source Gazebo environment (model paths, plugin paths, etc.)
GZ_ENV="$PX4_BUILD/rootfs/gz_env.sh"
if [ -f "$GZ_ENV" ]; then
  # shellcheck disable=SC1090
  source "$GZ_ENV"
elif [ -f "$PX4_BUILD/gz_env.sh" ]; then
  # shellcheck disable=SC1090
  source "$PX4_BUILD/gz_env.sh"
fi

# Add PX4's Gazebo model/world paths
export GZ_SIM_RESOURCE_PATH="${GZ_SIM_RESOURCE_PATH:+$GZ_SIM_RESOURCE_PATH:}/px4/Tools/simulation/gz/models:/px4/Tools/simulation/gz/worlds"

# Configure PX4 Gazebo model
export PX4_SIM_MODEL="gz_${PX4_GZ_MODEL}"
export PX4_GZ_MODEL="${PX4_GZ_MODEL}"

# MAVProxy: bridge PX4 internal UDP → external TCP
python3 -m MAVProxy.mavproxy \
  --daemon \
  --master=udpin:127.0.0.1:14550 \
  --out=tcpin:0.0.0.0:5760 \
  2>&1 > /tmp/mavproxy.log &

sleep 1

# Optional: start video bridge for camera models (e.g. x500_depth).
# Subscribes to the Gazebo camera topic via gz-transport Python bindings,
# encodes with GStreamer, and streams H.264 RTP/UDP to the host.
if [ "${GZ_VIDEO_ENABLED:-0}" = "1" ]; then
  echo "[entrypoint] Starting video bridge to ${GZ_VIDEO_HOST}:${GZ_VIDEO_PORT}"
  python3 /gz-video-bridge.py \
    --host "${GZ_VIDEO_HOST:-host.docker.internal}" \
    --port "${GZ_VIDEO_PORT:-5600}" \
    --world "${GZ_VIDEO_WORLD:-default}" \
    --model "${PX4_GZ_MODEL}_0" \
    --sensor "${GZ_VIDEO_SENSOR:-IMX214}" \
    > /tmp/video-bridge.log 2>&1 &
fi

# Run PX4 SITL (it will spawn Gazebo via gz_bridge)
exec "$PX4_BUILD/bin/px4" \
  "$PX4_DATA" \
  -s etc/init.d-posix/rcS \
  -t /px4/test_data
