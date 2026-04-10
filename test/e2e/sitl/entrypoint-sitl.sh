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

# Bridge PX4's internal UDP 14550 → TCP 5760 for external clients.
# MAVProxy's tcpin output is unreliable (single-client, no forwarding).
# Use a simple Python bidirectional bridge instead.
python3 -c "
import socket, threading, select, sys

UDP_ADDR = ('127.0.0.1', 14550)
TCP_PORT = 5760
udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
udp.bind(UDP_ADDR)

srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
srv.bind(('0.0.0.0', TCP_PORT))
srv.listen(1)

clients = []
lock = threading.Lock()
# PX4 sends FROM its own port TO 14550. Remember that source so we can
# send TCP→PX4 data back to the correct address.
px4_addr = None

def accept_loop():
    while True:
        conn, addr = srv.accept()
        with lock:
            clients.append(conn)

def udp_to_tcp():
    global px4_addr
    while True:
        data, src = udp.recvfrom(65535)
        # Remember the first non-self source as PX4's address
        if px4_addr is None and src[1] != 14550:
            px4_addr = src
        with lock:
            dead = []
            for c in clients:
                try:
                    c.sendall(data)
                except:
                    dead.append(c)
            for c in dead:
                clients.remove(c)
                try: c.close()
                except: pass

def tcp_to_udp():
    while True:
        with lock:
            rlist = list(clients)
        if not rlist:
            import time; time.sleep(0.1); continue
        readable, _, _ = select.select(rlist, [], [], 0.5)
        for c in readable:
            try:
                data = c.recv(65535)
                if data:
                    target = px4_addr or ('127.0.0.1', 14550)
                    udp.sendto(data, target)
                else:
                    raise ConnectionError
            except:
                with lock:
                    if c in clients: clients.remove(c)
                try: c.close()
                except: pass

threading.Thread(target=accept_loop, daemon=True).start()
threading.Thread(target=tcp_to_udp, daemon=True).start()
udp_to_tcp()
" &

# Give the bridge a moment to bind
sleep 1

# Run PX4 SITL in foreground
exec "$PX4_BUILD/bin/px4" \
  "$PX4_DATA" \
  -s etc/init.d-posix/rcS \
  -t /px4/test_data
