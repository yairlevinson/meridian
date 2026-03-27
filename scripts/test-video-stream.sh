#!/bin/bash
# Simulates a PX4/Gazebo camera video stream.
#
# PX4 + Gazebo streams H.264 over UDP to the GCS on port 5600.
# This script does the same using ffmpeg's test source pattern,
# so you can test Meridian's video receiver without Gazebo.
#
# Usage:
#   ./scripts/test-video-stream.sh          # default: 640x480@30fps to port 5600
#   ./scripts/test-video-stream.sh 5601     # custom port
#   ./scripts/test-video-stream.sh 5600 1280x720  # custom resolution

PORT=${1:-5600}
RESOLUTION=${2:-640x480}
FPS=30

echo "Streaming test video (H.264 MPEG-TS) to udp://127.0.0.1:${PORT}"
echo "Resolution: ${RESOLUTION} @ ${FPS}fps"
echo "Press Ctrl+C to stop"
echo ""

# Check if ffmpeg is available (prefer bundled, fall back to system)
FFMPEG="ffmpeg"
BUNDLED="$(dirname "$0")/../node_modules/ffmpeg-static/ffmpeg"
if [ -x "$BUNDLED" ]; then
  FFMPEG="$BUNDLED"
fi

exec "$FFMPEG" \
  -re \
  -f lavfi -i "testsrc=size=${RESOLUTION}:rate=${FPS}" \
  -pix_fmt yuv420p \
  -c:v libx264 \
  -preset ultrafast \
  -tune zerolatency \
  -profile:v baseline \
  -b:v 2000k \
  -g 30 \
  -an \
  -f mpegts \
  "udp://127.0.0.1:${PORT}?pkt_size=1316"
