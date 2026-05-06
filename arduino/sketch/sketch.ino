#include <avr/io.h>
#include <util/delay.h>

#define DMX_CHANNELS      512
#define DMX_DE_PIN        2
#define CHANNELS_PER_FIX  7
#define CH_DIMMER         0
#define CH_RED            1
#define CH_GREEN          2
#define CH_BLUE           3
#define CH_STROBE         4

uint8_t dmxBuffer[DMX_CHANNELS + 1];

void dmxInit() {
  pinMode(DMX_DE_PIN, OUTPUT);
  digitalWrite(DMX_DE_PIN, HIGH);  // MAX485 항상 송신 모드

  // 250kbaud @ 16MHz: UBRR = (16000000 / (16 * 250000)) - 1 = 3
  UBRR1H = 0;
  UBRR1L = 3;
  UCSR1A = 0;
  UCSR1B = (1 << TXEN1);                                  // TX만 활성화
  UCSR1C = (1 << USBS1) | (1 << UCSZ11) | (1 << UCSZ10);  // 8N2
}
static inline void dmxWriteByte(uint8_t data) {
  while (!(UCSR1A & (1 << UDRE1))) {}  // 송신 버퍼 비워질 때까지 대기
  UCSR1A |= (1 << TXC1);              // TXC1 클리어
  UDR1 = data;
}
// ── 1프레임 전송 ──────────────────────────────────────────────────────────────
void dmxSendFrame() {
  // 이전 프레임의 마지막 바이트 전송 완료 대기
  static bool firstFrame = true;
  if (!firstFrame) {
      while (!(UCSR1A & (1 << TXC1)));
  }
  firstFrame = false;

  // BREAK: USART TX 비활성화 후 PD3을 직접 LOW로 구동 (≥88µs)
  UCSR1B &= ~(1 << TXEN1);
  DDRD   |=  (1 << PD3);
  PORTD  &= ~(1 << PD3);
  delayMicroseconds(300);

  // MAB (Mark After Break): HIGH로 복귀 (≥8µs)
  PORTD  |=  (1 << PD3);
  delayMicroseconds(20);

  // USART TX 재활성화 후 버퍼 전송
  UCSR1B |= (1 << TXEN1);

  dmxWriteByte(0x00);  // Start code
  for (uint16_t i = 1; i <= DMX_CHANNELS; i++) {
    dmxWriteByte(dmxBuffer[i]);
  }
}

// ── 채널값 설정 (1-based) ─────────────────────────────────────────────────────
void setChannel(uint16_t channel, uint8_t value) {
  if (channel >= 1 && channel <= DMX_CHANNELS)
    dmxBuffer[channel] = value;
}

// ── 픽스처 설정 ───────────────────────────────────────────────────────────────
// base: 픽스처의 DMX 시작 채널 (1-based)
void setFixtureRGB(uint16_t base, uint8_t r, uint8_t g, uint8_t b) {
  setChannel(base + CH_DIMMER, 255);  // 디머 최대
  setChannel(base + CH_RED,    r);
  setChannel(base + CH_GREEN,  g);
  setChannel(base + CH_BLUE,   b);
}


void setup() {
  // put your setup code here, to run once:
  dmxInit();
  memset(dmxBuffer, 0, sizeof(dmxBuffer));
  // memset(dmxBuffer+1, 255, DMX_CHANNELS);
  setFixtureRGB(1, 0, 255, 0);
  setFixtureRGB(8, 255, 0, 0);

  for (uint8_t i=0;i<10;++i) {
    dmxSendFrame();
  }
}

void loop() {
  // put your main code here, to run repeatedly:
  dmxSendFrame();
}
