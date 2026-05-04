/*
 * lighting_controller.ino
 * Arduino Mega 2560 + Conceptinetics DMX Shield (or MAX485 module)
 *
 * Packet format (PC → Arduino): [0xFF][fixture_id][R][G][B]
 * Special IDs:  0xFE = BLACKOUT ALL,  0xFD = RESET
 * Heartbeat    (Arduino → PC):  [0xAA][0x01][dmx_running][pkt_count][err_count][0][0][0]
 *
 * Install via Arduino Library Manager: Conceptinetics
 */

#include <Conceptinetics.h>

// ── Configuration ─────────────────────────────────────────────────────────────
#define SERIAL_BAUD      115200
#define DMX_CHANNELS     512
#define DMX_MASTER_PIN   2        // RS-485 direction pin
#define MAX_FIXTURES     32
#define CHANNELS_PER_FIX 3

// ── Fixture Map ───────────────────────────────────────────────────────────────
// Maps logical ID (0-31) → DMX base channel (1-based). 0 = disabled.
// Must match resources/fixtures.json on the PC side.
uint16_t fixtureMap[MAX_FIXTURES] = {
  1,   // 0 → ch 1,2,3
  4,   // 1 → ch 4,5,6
  7,   // 2 → ch 7,8,9
  10,  // 3 → ch 10,11,12
  13,  // 4 → ch 13,14,15
  16,  // 5 → ch 16,17,18
  19,  // 6 → ch 19,20,21
  22,  // 7 → ch 22,23,24
  0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0
};

// ── Parser State Machine ──────────────────────────────────────────────────────
typedef enum {
  STATE_WAIT_START = 0,
  STATE_READ_ID,
  STATE_READ_R,
  STATE_READ_G,
  STATE_READ_B
} ParserState;

DMX_Master dmx_master(DMX_CHANNELS, DMX_MASTER_PIN);

ParserState parserState = STATE_WAIT_START;
uint8_t     pkt_id = 0, pkt_r = 0, pkt_g = 0;
uint32_t    packetCount = 0, errorCount = 0, lastHeartbeat = 0;

// ── Utilities ─────────────────────────────────────────────────────────────────
void blackoutAll() {
  for (int ch = 1; ch <= DMX_CHANNELS; ch++) dmx_master.setChannelValue(ch, 0);
}

void setFixture(uint8_t id, uint8_t r, uint8_t g, uint8_t b) {
  if (id >= MAX_FIXTURES) return;
  uint16_t base = fixtureMap[id];
  if (base == 0 || base + 2 > DMX_CHANNELS) return;
  dmx_master.setChannelValue(base,     r);
  dmx_master.setChannelValue(base + 1, g);
  dmx_master.setChannelValue(base + 2, b);
}

void sendHeartbeat() {
  uint8_t hb[8] = {
    0xAA, 0x01, 0x01,
    (uint8_t)(packetCount & 0xFF),
    (uint8_t)(errorCount  & 0xFF),
    0x00, 0x00, 0x00
  };
  Serial.write(hb, 8);
  packetCount = 0;
  errorCount  = 0;
}

// ── Parser ────────────────────────────────────────────────────────────────────
void parseSerial() {
  while (Serial.available() > 0) {
    uint8_t b = (uint8_t)Serial.read();

    switch (parserState) {
      case STATE_WAIT_START:
        if (b == 0xFF) parserState = STATE_READ_ID;
        break;

      case STATE_READ_ID:
        if (b == 0xFF) { errorCount++; parserState = STATE_READ_ID; }
        else if (b == 0xFE) { blackoutAll(); parserState = STATE_WAIT_START; packetCount++; }
        else if (b == 0xFD) { dmx_master.disable(); delay(10); dmx_master.enable(); parserState = STATE_WAIT_START; }
        else { pkt_id = b; parserState = STATE_READ_R; }
        break;

      case STATE_READ_R:
        if (b == 0xFF) { errorCount++; parserState = STATE_READ_ID; }
        else { pkt_r = b; parserState = STATE_READ_G; }
        break;

      case STATE_READ_G:
        if (b == 0xFF) { errorCount++; parserState = STATE_READ_ID; }
        else { pkt_g = b; parserState = STATE_READ_B; }
        break;

      case STATE_READ_B:
        if (b == 0xFF) { errorCount++; parserState = STATE_READ_ID; }
        else { setFixture(pkt_id, pkt_r, pkt_g, b); packetCount++; parserState = STATE_WAIT_START; }
        break;
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(SERIAL_BAUD);
  dmx_master.enable();
  blackoutAll();
}

void loop() {
  parseSerial();
  uint32_t now = millis();
  if (now - lastHeartbeat >= 1000) {
    sendHeartbeat();
    lastHeartbeat = now;
  }
}
