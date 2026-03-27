#!/usr/bin/env python3
"""
Bidirectional TCP<->UDP MAVLink bridge.

ArduPilot SITL (TCP 5760) <-> bridge <-> Meridian (UDP 14550)

The UDP socket binds to port 14549 so the Meridian auto-discovers it
at a fixed address and can send commands back through to ArduPilot over TCP.
The bridge forwards those incoming UDP packets to ArduPilot via TCP.
"""
import socket
import threading

TCP_HOST     = '127.0.0.1'
TCP_PORT     = 5760
UDP_BIND_PORT = 14549   # bridge listens here for outbound commands from Meridian
UDP_GCS_PORT  = 14550   # Meridian listens here for incoming telemetry

def tcp_to_udp(tcp: socket.socket, udp: socket.socket) -> None:
    """Forward ArduPilot TCP telemetry → Meridian UDP."""
    forwarded = 0
    while True:
        try:
            data = tcp.recv(4096)
            if not data:
                print('[bridge] TCP connection closed')
                break
            udp.sendto(data, (UDP_GCS_PORT,) if False else ('127.0.0.1', UDP_GCS_PORT))
            forwarded += len(data)
            if forwarded % 20000 < len(data):
                print(f'[bridge] tcp->udp {forwarded} bytes forwarded')
        except OSError:
            break

def udp_to_tcp(udp: socket.socket, tcp: socket.socket) -> None:
    """Forward Meridian UDP commands → ArduPilot TCP."""
    forwarded = 0
    while True:
        try:
            data, addr = udp.recvfrom(4096)
            tcp.sendall(data)
            forwarded += len(data)
            if forwarded % 1000 < len(data):
                print(f'[bridge] udp->tcp {forwarded} bytes forwarded (from {addr})')
        except OSError:
            break

def main() -> None:
    print(f'[bridge] Connecting to SITL TCP {TCP_HOST}:{TCP_PORT}...')
    tcp = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    tcp.connect((TCP_HOST, TCP_PORT))
    print(f'[bridge] Connected.')

    udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    udp.bind(('127.0.0.1', UDP_BIND_PORT))
    print(f'[bridge] UDP socket bound to port {UDP_BIND_PORT}')
    print(f'[bridge] Telemetry -> UDP:{UDP_GCS_PORT} | Commands <- UDP:{UDP_BIND_PORT} -> TCP')

    t1 = threading.Thread(target=tcp_to_udp, args=(tcp, udp), daemon=True)
    t2 = threading.Thread(target=udp_to_tcp, args=(udp, tcp), daemon=True)
    t1.start()
    t2.start()

    try:
        t1.join()
    except KeyboardInterrupt:
        print('[bridge] stopped')
    finally:
        tcp.close()
        udp.close()

if __name__ == '__main__':
    main()
