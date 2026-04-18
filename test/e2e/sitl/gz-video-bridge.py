#!/usr/bin/env python3
"""
Gazebo camera → GStreamer → H.264 RTP/UDP video bridge.

Subscribes to a Gazebo camera sensor topic via gz-transport Python bindings,
pipes raw frames into a GStreamer pipeline that encodes H.264 and streams
RTP packets over UDP.

This runs inside the meridian-px4-gz Docker container when GZ_VIDEO_ENABLED=1.

Usage:
    python3 gz-video-bridge.py [--port 5600] [--host host.docker.internal] \
        [--world default] [--model x500_depth_0] [--sensor IMX214]

Then in Meridian, set video source to UDP H.264, port 5600.
"""

import argparse
import os
import signal
import subprocess
import sys
import time
import threading

# PX4 launches Gazebo with GZ_IP=127.0.0.1 — must match for transport discovery
if 'GZ_IP' not in os.environ:
    os.environ['GZ_IP'] = '127.0.0.1'

from gz.transport13 import Node, SubscribeOptions
from gz.msgs10 import image_pb2


# Gazebo pixel format enum → GStreamer rawvideoparse format name
GZ_TO_GST_FORMAT = {
    1: 'gray8',
    2: 'gray16-le',
    3: 'rgb',
    4: 'bgr',
    6: 'rgba',
    7: 'bgra',
    8: 'rgb48le',
}


def main():
    parser = argparse.ArgumentParser(description='Stream Gazebo camera via GStreamer RTP')
    parser.add_argument('--port', type=int, default=5600, help='UDP port (default: 5600)')
    parser.add_argument('--host', default='host.docker.internal', help='UDP host (default: host.docker.internal)')
    parser.add_argument('--world', default='default', help='Gazebo world name')
    parser.add_argument('--model', default='x500_depth_0', help='Vehicle model name')
    parser.add_argument('--sensor', default='IMX214', help='Camera sensor name')
    parser.add_argument('--fps', type=int, default=30, help='Output framerate (default: 30)')
    parser.add_argument('--bitrate', type=int, default=2000, help='H.264 bitrate in kbps (default: 2000)')
    parser.add_argument('--topic', default=None, help='Override full topic path')
    args = parser.parse_args()

    if args.topic:
        topic = args.topic
    else:
        topic = f'/world/{args.world}/model/{args.model}/link/camera_link/sensor/{args.sensor}/image'

    print(f'[gz-video] Topic: {topic}')
    print(f'[gz-video] Streaming H.264 RTP to {args.host}:{args.port}')

    node = Node()
    gst_proc = None
    frame_count = 0
    lock = threading.Lock()

    def start_gstreamer(width, height, gst_fmt):
        """Pipeline: rawvideo → x264enc → h264parse (Annex B, config-in-stream) → udpsink.

        Meridian's `UDP_H264` receiver reads each datagram as raw H.264 Annex B
        bytes (no RTP depayloader). We therefore skip `rtph264pay` and make sure
        the parser emits byte-stream format with SPS/PPS repeated periodically
        so the decoder can sync mid-stream.
        """
        cmd = [
            'gst-launch-1.0', '-q',
            'fdsrc', 'fd=0',
            '!', f'rawvideoparse', f'width={width}', f'height={height}',
                 f'format={gst_fmt}', f'framerate={args.fps}/1',
            '!', 'videoconvert',
            '!', 'x264enc',
                 'tune=zerolatency',
                 f'bitrate={args.bitrate}',
                 'speed-preset=ultrafast',
                 f'key-int-max={args.fps}',
            '!', 'h264parse', 'config-interval=1',
            '!', 'video/x-h264,stream-format=byte-stream,alignment=au',
            '!', 'udpsink', f'host={args.host}', f'port={args.port}',
        ]
        print(f'[gz-video] Starting: {" ".join(cmd)}')
        return subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)

    def on_image(raw_bytes: bytes, msg_info):
        nonlocal gst_proc, frame_count

        img = image_pb2.Image()
        img.ParseFromString(raw_bytes)

        width = img.width
        height = img.height
        pixel_fmt = img.pixel_format_type
        gst_fmt = GZ_TO_GST_FORMAT.get(pixel_fmt, 'rgb')

        with lock:
            if gst_proc is None:
                print(f'[gz-video] First frame: {width}x{height}, gz_fmt={pixel_fmt} gst_fmt={gst_fmt}')
                gst_proc = start_gstreamer(width, height, gst_fmt)

            try:
                gst_proc.stdin.write(img.data)
                frame_count += 1
                if frame_count % 300 == 0:
                    print(f'[gz-video] {frame_count} frames')
            except BrokenPipeError:
                print('[gz-video] GStreamer pipe broken, restarting...')
                gst_proc = start_gstreamer(width, height, gst_fmt)
                gst_proc.stdin.write(img.data)

    opts = SubscribeOptions()
    success = node.subscribe_raw(topic, on_image, 'gz.msgs.Image', opts)

    if not success:
        print(f'[gz-video] Failed to subscribe to {topic}')
        print('[gz-video] Waiting for topic to appear...')
        # Retry subscription for up to 2 minutes (Gazebo may still be starting)
        for _ in range(60):
            time.sleep(2)
            success = node.subscribe_raw(topic, on_image, 'gz.msgs.Image', opts)
            if success:
                break
        if not success:
            print(f'[gz-video] Topic {topic} never appeared, exiting')
            sys.exit(1)

    print('[gz-video] Subscribed, waiting for frames...')

    def shutdown(sig, frame):
        print('\n[gz-video] Shutting down...')
        with lock:
            if gst_proc and gst_proc.stdin:
                gst_proc.stdin.close()
                gst_proc.wait(timeout=5)
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        shutdown(None, None)


if __name__ == '__main__':
    main()
