/*
 * lighting_controller.ino
 * Arduino Mega 2560 + MAX485 module
 * No external DMX library — drives USART1 directly to avoid conflicts with Serial (USART0).
 * Both use the same ATmega2560 interrupt vector (__vector_25), causing a linker error
 * if the Conceptinetics library and HardwareSerial are compiled together.
 *
 * Packet format (PC → Arduino): [0xFF][fixture_id][R][G][B]
 * Special IDs:  0xFE = BLACKOUT ALL,  0xFD = RESET
 * Heartbeat    (Arduino → PC):  [0xAA][0x01][dmx_running][pkt_count][err_count][0][0][0]
 *
 * Wiring (Mega 2560):
 *   MAX485 DI    → pin 18  (TX1 = PD3)
 *   MAX485 DE+RE → pin 2   (direction control)
 *   MAX485 RO    → pin 19  (RX1, unused)
 *   MAX485 A/B   → DMX+ / DMX-
 */

#include <avr/io.h>
#include <util/delay.h>

// ── Configuration ─────────────────────────────────────────────────────────────
#define SERIAL_BAUD      115200
#define DMX_CHANNELS     56       // highest used: fixture 7 base 50 + 6 = ch 56
#define DMX_DE_PIN       2
#define MAX_FIXTURES     32
#define CHANNELS_PER_FIX 7       // 7-ch RGB PAR: Dimmer/R/G/B/Strobe/Mode/Speed

// Channel offsets within each fixture block
#define CH_DIMMER  0
#define CH_RED     1
#define CH_GREEN   2
#define CH_BLUE    3
#define CH_STROBE  4
#define CH_MODE    5
#define CH_SPEED   6

// ── Fixture Map ───────────────────────────────────────────────────────────────
// Maps logical ID (0-31) → DMX base channel (1-based). 0 = disabled.
// Each fixture occupies 7 channels. Must match resources/fixtures.json.
uint16_t fixtureMap[MAX_FIXTURES] = {
  1,   // 0 → ch 1-7
  8,   // 1 → ch 8-14
  15,  // 2 → ch 15-21
  22,  // 3 → ch 22-28
  29,  // 4 → ch 29-35
  36,  // 5 → ch 36-42
  43,  // 6 → ch 43-49
  50,  // 7 → ch 50-56
  0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0
};

// ── DMX buffer ────────────────────────────────────────────────────────────────
// [0] = start code (always 0), [1..512] = channel values
uint8_t dmxBuffer[DMX_CHANNELS + 1];

// ── setChannelValue ───────────────────────────────────────────────────────────
// Same API as dmx_master.setChannelValue() — channel is 1-based.
static inline void setChannelValue(uint16_t channel, uint8_t value) {
  if (channel >= 1 && channel <= DMX_CHANNELS)
    dmxBuffer[channel] = value;
}

// ── USART1 DMX driver ─────────────────────────────────────────────────────────
// TX1 = PD3 (Arduino Mega pin 18). USART1 runs at 250 kbaud, 8N2.
// Serial (USART0) is untouched — no library conflict possible.

void dmxInit() {
  pinMode(DMX_DE_PIN, OUTPUT);
  digitalWrite(DMX_DE_PIN, HIGH);   // always transmit

  // 250 kbaud @ 16 MHz: UBRR = 16000000/(16*250000) - 1 = 3
  UBRR1H = 0;
  UBRR1L = 3;
  UCSR1A = 0;
  UCSR1B = (1 << TXEN1);                                    // TX enable only
  UCSR1C = (1 << USBS1) | (1 << UCSZ11) | (1 << UCSZ10);  // 8N2
}

// Sends one byte; drains incoming PC serial while waiting for UDRE1.
static inline void dmxWriteByte(uint8_t data) {
  while (!(UCSR1A & (1 << UDRE1))) {}
  UCSR1A |= (1 << TXC1);   // write 1 to clear TXC1 before loading new byte
  UDR1 = data;
}

void dmxSendFrame() {
  // Skip TXC1 wait on the very first call — no byte has been sent yet so
  // the hardware never sets the flag, which would hang the loop forever.
  static bool firstFrame = true;
  if (!firstFrame) {
    while (!(UCSR1A & (1 << TXC1)));
  }
  firstFrame = false;

  // BREAK: disable USART TX, drive PD3 low for ≥88 µs
  UCSR1B &= ~(1 << TXEN1);
  DDRD   |=  (1 << PD3);
  PORTD  &= ~(1 << PD3);
  delayMicroseconds(100);

  // Mark After Break: high for ≥8 µs
  PORTD  |=  (1 << PD3);
  delayMicroseconds(12);

  // Re-enable USART TX (takes over PD3)
  UCSR1B |=  (1 << TXEN1);

  // Start code + 512 channels
  dmxWriteByte(0x00);
  for (uint16_t i = 1; i <= DMX_CHANNELS; i++) {
    dmxWriteByte(dmxBuffer[i]);
  }
}

void dmxDisable() {
  UCSR1B &= ~(1 << TXEN1);
  DDRD   |=  (1 << PD3);
  PORTD  &= ~(1 << PD3);   // hold line low (blackout safe)
}

void dmxEnable() {
  UCSR1B |= (1 << TXEN1);
}

// ── Utilities ─────────────────────────────────────────────────────────────────
void blackoutAll() {
  memset(dmxBuffer, 0, sizeof(dmxBuffer));
}

void setFixture(uint8_t id, uint8_t r, uint8_t g, uint8_t b) {
  if (id >= MAX_FIXTURES) return;
  uint16_t base = fixtureMap[id];
  if (base == 0 || base + (CHANNELS_PER_FIX - 1) > DMX_CHANNELS) return;
  setChannelValue(base + CH_DIMMER, 255);  // full brightness; PC already scales RGB by dimmer
  setChannelValue(base + CH_RED,    r);
  setChannelValue(base + CH_GREEN,  g);
  setChannelValue(base + CH_BLUE,   b);
  setChannelValue(base + CH_STROBE, 0);
  setChannelValue(base + CH_MODE,   0);
  setChannelValue(base + CH_SPEED,  0);
  // CH_STROBE, CH_MODE, CH_SPEED left at 0 (static color, no strobe)
}

// ── Parser State Machine ──────────────────────────────────────────────────────
typedef enum {
  STATE_WAIT_START = 0,
  STATE_READ_ID,
  STATE_READ_R,
  STATE_READ_G,
  STATE_READ_B
} ParserState;

ParserState parserState = STATE_WAIT_START;
uint8_t     pkt_id = 0, pkt_r = 0, pkt_g = 0;
uint32_t    packetCount = 0, errorCount = 0, lastHeartbeat = 0;

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
        else if (b == 0xFD) { dmxDisable(); delay(10); dmxEnable(); parserState = STATE_WAIT_START; }
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
  dmxInit();
  blackoutAll();
  dmxSendFrame();
  Serial.begin(SERIAL_BAUD);
}

void loop() {
  dmxSendFrame();
  parseSerial();

  uint32_t now = millis();
  if (now - lastHeartbeat >= 1000) {
      sendHeartbeat();
      lastHeartbeat = now;
  }
}
