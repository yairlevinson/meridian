#!/usr/bin/env python3
"""
Gazebo camera → UDP H.264 video bridge for Meridian.

Subscribes to a Gazebo camera sensor topic, encodes raw frames as H.264
via ffmpeg, and sends MPEG-TS packets over UDP using a Python socket
(avoids ffmpeg's UDP muxer which binds the destination port).

Usage:
    python3 scripts/gz-video-stream.py [--port 5600] [--world default] [--model x500_depth_0] [--sensor IMX214]

Then in Meridian, set video source to UDP H.264, port 5600.

Note: PX4 sets GZ_IP=127.0.0.1 which restricts Gazebo transport to localhost.
This script sets it automatically so topic discovery works.
"""

import argparse
import os
import signal
import socket
import subprocess
import sys
import time
import threading

# PX4 launches Gazebo with GZ_IP=127.0.0.1 — must match for transport discovery
if 'GZ_IP' not in os.environ:
    os.environ['GZ_IP'] = '127.0.0.1'

from gz.transport13 import Node, SubscribeOptions
from gz.msgs10 import image_pb2


# Gazebo pixel format enum values (from gz::msgs::PixelFormatType)
PIXEL_FORMAT = {
    1: 'gray8',      # L_INT8
    2: 'gray16le',   # L_INT16
    3: 'rgb24',      # RGB_INT8
    6: 'rgba',       # RGBA_INT8
    7: 'bgra',       # BGRA_INT8
    8: 'rgb48le',    # RGB_INT16
    9: 'rgb32f',     # RGB_FLOAT32
    4: 'bgr24',      # BGR_INT8 (some Gazebo versions)
}


def main():
    parser = argparse.ArgumentParser(description='Stream Gazebo camera to UDP H.264')
    parser.add_argument('--port', type=int, default=5600, help='UDP port to stream to (default: 5600)')
    parser.add_argument('--host', default='127.0.0.1', help='UDP destination host (default: 127.0.0.1)')
    parser.add_argument('--world', default='default', help='Gazebo world name (default: default)')
    parser.add_argument('--model', default='x500_depth_0', help='Vehicle model name (default: x500_depth_0)')
    parser.add_argument('--sensor', default='IMX214', help='Camera sensor name (default: IMX214)')
    parser.add_argument('--fps', type=int, default=30, help='Output framerate (default: 30)')
    parser.add_argument('--bitrate', default='2000k', help='H.264 bitrate (default: 2000k)')
    parser.add_argument('--topic', default=None, help='Override full topic path (auto-constructed if omitted)')
    args = parser.parse_args()

    if args.topic:
        topic = args.topic
    else:
        topic = f'/world/{args.world}/model/{args.model}/link/camera_link/sensor/{args.sensor}/image'

    print(f'[gz-video] Subscribing to: {topic}')
    print(f'[gz-video] Streaming H.264 to udp://{args.host}:{args.port}')

    node = Node()
    ffmpeg_proc = None
    frame_count = 0
    lock = threading.Lock()

    # UDP socket for sending MPEG-TS packets (doesn't bind the destination port)
    udp_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    dest = (args.host, args.port)

    def start_ffmpeg(width, height, pix_fmt):
        """Start ffmpeg subprocess — outputs MPEG-TS to stdout."""
        cmd = [
            'ffmpeg',
            '-y',
            '-f', 'rawvideo',
            '-pixel_format', pix_fmt,
            '-video_size', f'{width}x{height}',
            '-framerate', str(args.fps),
            '-i', 'pipe:0',
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-tune', 'zerolatency',
            '-pix_fmt', 'yuv420p',
            '-profile:v', 'baseline',
            '-b:v', args.bitrate,
            '-g', '30',
            '-keyint_min', '30',
            '-an',
            '-f', 'mpegts',
            'pipe:1',
        ]
        print(f'[gz-video] Starting ffmpeg: {" ".join(cmd)}')
        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

        # Thread to read ffmpeg stdout and send via UDP
        def udp_sender():
            total = 0
            while True:
                data = proc.stdout.read(1316)  # MPEG-TS packet size
                if not data:
                    break
                try:
                    udp_sock.sendto(data, dest)
                    total += len(data)
                    if total % 500000 < len(data):
                        print(f'[gz-video] UDP sent: {total // 1024} KB')
                except OSError:
                    break

        t = threading.Thread(target=udp_sender, daemon=True)
        t.start()

        return proc

    def on_image(raw_bytes: bytes, msg_info):
        nonlocal ffmpeg_proc, frame_count

        img = image_pb2.Image()
        img.ParseFromString(raw_bytes)

        width = img.width
        height = img.height
        pixel_fmt = img.pixel_format_type
        pix_fmt = PIXEL_FORMAT.get(pixel_fmt, 'rgb24')

        with lock:
            if ffmpeg_proc is None:
                print(f'[gz-video] First frame: {width}x{height}, format={pixel_fmt} ({pix_fmt})')
                ffmpeg_proc = start_ffmpeg(width, height, pix_fmt)

            try:
                ffmpeg_proc.stdin.write(img.data)
                frame_count += 1
                if frame_count % 300 == 0:
                    print(f'[gz-video] {frame_count} frames sent')
            except BrokenPipeError:
                print('[gz-video] ffmpeg pipe broken, restarting...')
                ffmpeg_proc = start_ffmpeg(width, height, pix_fmt)
                ffmpeg_proc.stdin.write(img.data)

    opts = SubscribeOptions()
    success = node.subscribe_raw(topic, on_image, 'gz.msgs.Image', opts)

    if not success:
        print(f'[gz-video] Failed to subscribe to {topic}')
        print('[gz-video] Make sure PX4 SITL with a camera model is running (e.g. make px4_sitl gz_x500_depth)')
        sys.exit(1)

    print('[gz-video] Subscribed, waiting for frames...')
    print('[gz-video] Press Ctrl+C to stop')

    def shutdown(sig, frame):
        print('\n[gz-video] Shutting down...')
        with lock:
            if ffmpeg_proc and ffmpeg_proc.stdin:
                ffmpeg_proc.stdin.close()
                ffmpeg_proc.wait(timeout=5)
        udp_sock.close()
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
