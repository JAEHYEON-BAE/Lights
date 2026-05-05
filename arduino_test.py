#!/usr/bin/env python3
"""
Arduino lighting controller test script.
Matches lighting_controller.ino exactly:
  PC → Arduino : [0xFF][id][R][G][B]   (id 0–7 active)
                  [0xFF][0xFE][...] = blackout all
                  [0xFF][0xFD][...] = DMX reset
  Arduino → PC : [0xAA][0x01][0x01][pkt_count][err_count][0][0][0]  (every 1 s)

NOTE: 0xFF is NOT a valid R/G/B value — firmware treats it as a framing error.
      fixtureMap: 0→ch1, 1→ch8, 2→ch15, 3→ch22, 4→ch29, 5→ch36, 6→ch43, 7→ch50

Usage:
  python arduino_test.py [port]
  Omit port to auto-detect /dev/cu.usbmodem* or /dev/cu.usbserial*
"""

import sys, time, glob, threading
import serial

# ── Fixtures active in fixtureMap (id: dmx_base) ──────────────────────────────
FIXTURE_MAP = {0: 1, 1: 8, 2: 15, 3: 22, 4: 29, 5: 36, 6: 43, 7: 50}
BAUD = 115200


def find_port():
    candidates = glob.glob("/dev/cu.usbmodem*") + glob.glob("/dev/cu.usbserial*")
    if not candidates:
        sys.exit("No USB serial port found. Plug in the Arduino or pass port as argument.")
    if len(candidates) > 1:
        print(f"Multiple ports: {candidates}")
    return candidates[0]


def fixture_packet(fixture_id, r, g, b):
    # clamp — 0xFF is invalid for R/G/B (firmware treats it as framing error)
    return bytes([0xFF, fixture_id, min(r, 0xFE), min(g, 0xFE), min(b, 0xFE)])

def blackout_packet():
    return bytes([0xFF, 0xFE, 0, 0, 0])

def reset_packet():
    return bytes([0xFF, 0xFD, 0, 0, 0])


# ── Heartbeat reader (background thread) ──────────────────────────────────────
class HeartbeatReader(threading.Thread):
    def __init__(self, ser):
        super().__init__(daemon=True)
        self.ser = ser
        self.count = 0
        self.last = None

    def run(self):
        buf = bytearray()
        while True:
            try:
                chunk = self.ser.read(self.ser.in_waiting or 1)
            except Exception:
                break
            buf.extend(chunk)
            while len(buf) >= 8:
                if buf[0] == 0xAA and buf[1] == 0x01:
                    hb = buf[:8]
                    buf = buf[8:]
                    self.count += 1
                    self.last = hb
                    # hb[2] = dmx_running (hardcoded 0x01 in firmware)
                    # hb[3] = pkt_count since last heartbeat (resets each second)
                    # hb[4] = err_count since last heartbeat (resets each second)
                    print(f"\n  [HB #{self.count}] dmx_running={hb[2]}  "
                          f"pkt_count={hb[3]}  err_count={hb[4]}")
                else:
                    buf.pop(0)  # re-sync on bad data


# ── Tests ──────────────────────────────────────────────────────────────────────
def test_all_fixtures(ser):
    """Flash each active fixture white then black in sequence."""
    print("\n-- test_all_fixtures: cycling through fixtures 0–7 --")
    for fid, base in FIXTURE_MAP.items():
        print(f"  fixture {fid}  (DMX base ch {base})  → white", end="", flush=True)
        ser.write(fixture_packet(fid, 254, 254, 254))
        time.sleep(0.4)
        ser.write(blackout_packet())
        print("  → blackout")
        time.sleep(0.2)


def test_rgb_channels(ser, fixture_id=0):
    """Individually exercise R, G, B channels on one fixture."""
    print(f"\n-- test_rgb_channels: fixture {fixture_id} --")
    for label, r, g, b in [("RED", 254, 0, 0), ("GREEN", 0, 254, 0), ("BLUE", 0, 0, 254)]:
        print(f"  {label}")
        ser.write(fixture_packet(fixture_id, r, g, b))
        time.sleep(0.6)
    ser.write(blackout_packet())
    print("  BLACKOUT")


def test_blackout_and_reset(ser):
    """Verify 0xFE blackout and 0xFD DMX reset commands."""
    print("\n-- test_blackout_and_reset --")
    ser.write(fixture_packet(0, 254, 254, 254))
    time.sleep(0.3)
    print("  sending BLACKOUT (0xFE)")
    ser.write(blackout_packet())
    time.sleep(0.5)
    print("  sending DMX RESET (0xFD)")
    ser.write(reset_packet())
    time.sleep(0.5)


# ── Main ───────────────────────────────────────────────────────────────────────
port = sys.argv[1] if len(sys.argv) > 1 else find_port()
print(f"Connecting to {port} at {BAUD} baud...")

with serial.Serial(port, BAUD, timeout=3) as ser:
    time.sleep(2)           # wait for Arduino reset after serial open
    ser.reset_input_buffer()
    print("Connected. Heartbeats will appear inline as they arrive.\n")

    # Raw diagnostic: if ANYTHING arrives in 3 s, firmware is alive but packet
    # parsing may be off. If nothing arrives, the Arduino is hung or not programmed.
    print("Raw check: listening for any bytes from Arduino (3 s)...")
    raw = ser.read(16)
    if raw:
        print(f"  Raw bytes received: {raw.hex(' ')}")
    else:
        print("  Nothing received — Arduino may be hung or firmware not uploaded.")
        print("  Fix: re-flash with the corrected lighting_controller.ino and retry.")
        sys.exit(1)

    ser.reset_input_buffer()
    print()

    hb = HeartbeatReader(ser)
    hb.start()

    test_all_fixtures(ser)
    test_rgb_channels(ser, fixture_id=0)
    test_blackout_and_reset(ser)

    print("\nWaiting 3 s for final heartbeats...")
    time.sleep(3)

    if hb.count == 0:
        print("\nERROR: No heartbeat received — check wiring, port, and baud rate.")
    else:
        print(f"\nOK: {hb.count} heartbeat(s) received. Arduino firmware is running correctly.")
