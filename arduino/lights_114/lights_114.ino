#define USE_DMX_SERIAL_1
#include <Conceptinetics.h>
#include <string.h>
#include <ctype.h>  // isdigit

// ===== DMX configuration =====
#define FIXTURE_COUNT 6
#define CHANNELS_PER_FIXTURE 7
#define DMX_MASTER_CHANNELS (FIXTURE_COUNT * CHANNELS_PER_FIXTURE)
#define RXEN_PIN 2

DMX_Master dmx_master(DMX_MASTER_CHANNELS, RXEN_PIN);

// ===== Color types =====
struct Color { byte r, g, b; };
struct NamedColor { const char* name; byte r, g, b; };

// ===== Palette =====
const NamedColor palette[11] = {
  {"PINK",     255,  20,  40},
  {"YELLOW",   180, 120,  20},
  {"LYELLOW",  255, 190,  55},
  {"BLUE",       31,  59, 250},
  {"LBLUE",     221, 229, 255},
  {"PURPLE",    200,  69, 140},
  {"MBVRED",    255,  10,  10},
  {"RED",       255,   5,   5},
  {"JJBLUE",     31, 201, 255},
  {"JJGREEN",    31, 255,  97},
  {"WHITE",     255, 255, 170}
};

// ===== Song palette list =====
const char* songColorNames[16][4] = {
  {"PINK","MBVRED",NULL,NULL},     // 0 mbv
  {"YELLOW","LYELLOW",NULL,NULL},  // 1 tsukuru
  {"BLUE","LBLUE",NULL,NULL},      // 2 kuni
  {"YELLOW","BLUE","LYELLOW","LBLUE"}, // 3 seamless
  {"LBLUE","LYELLOW",NULL,NULL},   // 4 DP
  {"YELLOW","LYELLOW",NULL,NULL},  // 5 yours
  {"BLUE","LBLUE",NULL,NULL},      // 6 someday
  {"YELLOW","LYELLOW",NULL,NULL},  // 7 chowchow
  {"PINK","LYELLOW",NULL,NULL},      // 8 pink
  {"RED","PURPLE",NULL,NULL},       // 9 be quiet
  {"YELLOW","PURPLE",NULL,NULL},  // 10 dead forever
  {"PURPLE","LYELLOW",NULL,NULL},    // 11 violet
  {"YELLOW","LYELLOW",NULL,NULL},  // 12 lights off
  {"JJBLUE","WHITE",NULL,NULL},    // 13 beautiful world
  {"JJBLUE","JJGREEN",NULL,NULL},  // 14 youth rebellion
  {"LYELLOW",NULL,NULL,NULL}         // 15
};

bool mentLightActive = false;  
unsigned long hayakuStart = 0;
bool hayakuActive = false;

// ===== Name lookup =====
int colorIndexFromName(const char* name){
  if(!name) return 9;
  for(int i=0;i<10;i++){
    if(strcmp(palette[i].name,name)==0) return i;
  }
  return 9; // default white
}

Color getSongColor(int songId,int slot){
  const char* nm=songColorNames[songId][slot];
  int idx=colorIndexFromName(nm);
  Color c = {palette[idx].r,palette[idx].g,palette[idx].b};
  return c;
}

// ===== Global state =====
int abletonValue=0;
int currentSong=0;
int currentPattern=0;

// ★ DEBUG: 값 변할 때만 로그
static int lastAbletonValue = -999;

// ===== Math =====
float normSin(unsigned long t,int periodMs){
  return (sin(2*PI*((float)t/periodMs))+1.0)*0.5;
}

// ===== DMX out =====
void setFixtureRGB(int id,byte r,byte g,byte b,byte dim){
  int base=1+id*CHANNELS_PER_FIXTURE;
  dmx_master.setChannelValue(base+0,dim);
  dmx_master.setChannelValue(base+1,r);
  dmx_master.setChannelValue(base+2,g);
  dmx_master.setChannelValue(base+3,b);
  dmx_master.setChannelValue(base+4,0);
  dmx_master.setChannelValue(base+5,0);
  dmx_master.setChannelValue(base+6,0);
}

void setAllRGB(byte r,byte g,byte b,byte dim){
  for(int i=0;i<FIXTURE_COUNT;i++)
    setFixtureRGB(i,r,g,b,dim);
}

void fadeOutAll(int durationMs) {


  const int steps = 40;
  const int wait = durationMs / steps;

  for (int s = steps; s >= 0; s--) {
    byte dim = (byte)(255.0 * s / steps);

    for (int i = 0; i < FIXTURE_COUNT; i++) {
      dmx_master.setChannelValue(1 + i*CHANNELS_PER_FIXTURE + 0, dim);
    }

    dmx_master.breakAndContinue();
    delay(wait);
  }

  // 마지막으로 완전 끔
  setAllRGB(0,0,0,0);
}



//=======Patterns==========
void patternSolid(int songId){
  Color c=getSongColor(songId,0);
  setAllRGB(c.r,c.g,c.b,255);
}

void solidForTsukuru(){
  setAllRGB(255,255,255,255);
}

void patternHayakuBreath(int songId) {
  Color c1 = getSongColor(songId, 0);
  Color c2 = getSongColor(songId, 1);

  unsigned long t = millis();
  static unsigned long startT = millis();

  // 총 빌드업 시간(ms) — 25초
  float total = 25000.0;
  float elapsed = t - startT;
  float norm = min(elapsed / total, 1.0); // 0~1

  // 곡선 가속도 (5~8 사이 추천)
  float k = 5.9;
  float accel = pow(norm, k); // 0 → 거의 0 → 마지막에 급상승

  // period Interpolation (커브 기반)
  float startPeriodA = 3500, endPeriodA = 500; 
  float startPeriodB = 3700, endPeriodB = 700;

  float periodA = startPeriodA * (1.0 - accel) + endPeriodA * accel;
  float periodB = startPeriodB * (1.0 - accel) + endPeriodB * accel;

  // dim 커브도 조금: 초기 부드럽고 마지막 punchy
  float startDimA = 80, endDimA = 30;
  float startDimB = 90, endDimB = 40;

  float minDimA = startDimA * (1.0 - accel) + endDimA * accel;
  float minDimB = startDimB * (1.0 - accel) + endDimB * accel;

  // 그룹별 위상
  float phaseA[3] = {0.0, 0.23, -0.18};
  float phaseB[3] = {0.11, -0.26, 0.31};

  int aIdx[3] = {0,2,4};
  int bIdx[3] = {1,3,5};

  // A group (slot0)
  for(int i=0;i<3;i++){
    float v = (sin((float)t / periodA * 2 * PI + phaseA[i]*PI)+1)*0.5;
    byte dim = (byte)(minDimA + v * (255 - minDimA));
    setFixtureRGB(aIdx[i], c1.r, c1.g, c1.b, dim);
  }

  // B group (slot1)
  for(int i=0;i<3;i++){
    float v = (sin((float)t / periodB * 2 * PI + phaseB[i]*PI)+1)*0.5;
    byte dim = (byte)(minDimB + v * (255 - minDimB));
    setFixtureRGB(bIdx[i], c2.r, c2.g, c2.b, dim);
  }
}




void blueSolidForSeamless(int slot){
  byte r, g, b;
  if (slot == 0) { r = 31; g = 59; b = 250; } // BLUE
  else           { r = 221; g = 229; b = 255; } // LBLUE
  setAllRGB(r, g, b, 35);
}

void yellowSolidForSeamless(){
  setAllRGB(180, 120, 20, 255);
}

void blueBreathForSeamless(int preset) {
  Color c1 = {31, 59, 250};      // BLUE
  Color c2 = {221, 229, 255};    // LBLUE
  unsigned long t = millis();

  int minDimA, minDimB, periodA, periodB;
  switch(preset) {
    case 0: minDimA=100;minDimB=100;periodA=4000;periodB=4200;break;
    case 1: minDimA=80; minDimB=90; periodA=3000;periodB=3500;break;
    case 2: minDimA=60; minDimB=80; periodA=1800;periodB=2400;break;
    case 3: minDimA=40; minDimB=90; periodA=900; periodB=1600;break;
    default:minDimA=60; minDimB=80; periodA=1800;periodB=2400;break;
  }

  float vA = normSin(t, periodA);
  float vB = normSin(t, periodB);
  byte dimA = (byte)(minDimA + vA * (255 - minDimA));
  byte dimB = (byte)(minDimB + vB * (255 - minDimB));

  setFixtureRGB(0, c1.r, c1.g, c1.b, dimA);
  setFixtureRGB(2, c1.r, c1.g, c1.b, dimA);
  setFixtureRGB(4, c1.r, c1.g, c1.b, dimA);

  setFixtureRGB(1, c2.r, c2.g, c2.b, dimB);
  setFixtureRGB(3, c2.r, c2.g, c2.b, dimB);
  setFixtureRGB(5, c2.r, c2.g, c2.b, dimB);
}

void lmixBreathForSeamless() {
  byte rA=221,gA=229,bA=255;  // LBLUE
  byte rB=255,gB=190,bB=55;   // LYELLOW
  int minDimA=60,minDimB=80, periodA=1800,periodB=2400;
  unsigned long t=millis();
  float vA=normSin(t,periodA), vB=normSin(t,periodB);
  byte dimA=(byte)(minDimA+vA*(255-minDimA));
  byte dimB=(byte)(minDimB+vB*(255-minDimB));
  setFixtureRGB(0,rA,gA,bA,dimA); setFixtureRGB(2,rA,gA,bA,dimA); setFixtureRGB(4,rA,gA,bA,dimA);
  setFixtureRGB(1,rB,gB,bB,dimB); setFixtureRGB(3,rB,gB,bB,dimB); setFixtureRGB(5,rB,gB,bB,dimB);
}

void mixBreathForSeamless() {
  byte rA=180,gA=120,bA=20;   // YELLOW
  byte rB=31, gB=59, bB=250;  // BLUE
  int minDimA=60,minDimB=80, periodA=1800,periodB=2400;
  unsigned long t=millis();
  float vA=normSin(t,periodA), vB=normSin(t,periodB);
  byte dimA=(byte)(minDimA+vA*(255-minDimA));
  byte dimB=(byte)(minDimB+vB*(255-minDimB));
  setFixtureRGB(0,rA,gA,bA,dimA); setFixtureRGB(2,rA,gA,bA,dimA); setFixtureRGB(4,rA,gA,bA,dimA);
  setFixtureRGB(1,rB,gB,bB,dimB); setFixtureRGB(3,rB,gB,bB,dimB); setFixtureRGB(5,rB,gB,bB,dimB);
}

void patternSingleBreathPreset(int songId, int slot, int preset) {
  Color c = getSongColor(songId, slot);
  unsigned long t = millis();
  int minDim, period;
  switch(preset) {
    case 0: minDim=100; period=4000; break;
    case 1: minDim=80;  period=3000; break;
    case 2: minDim=60;  period=1800; break;
    case 3: minDim=40;  period=900;  break;
    default:minDim=60;  period=1800; break;
  }
  float v = normSin(t, period);
  byte dim = (byte)(minDim + v * (255 - minDim));
  for(int i=0;i<FIXTURE_COUNT;i++) setFixtureRGB(i, c.r,c.g,c.b, dim);
}

void patternGroupedBreathPreset(int songId, int preset) {
  Color c1 = getSongColor(songId, 0);
  Color c2 = getSongColor(songId, 1);
  unsigned long t = millis();

  int minDimA, minDimB, periodA, periodB;
  switch(preset) {
    case 0: minDimA=100;minDimB=100;periodA=4000;periodB=4200;break;
    case 1: minDimA=80; minDimB=90; periodA=3000;periodB=3500;break;
    case 2: minDimA=60; minDimB=80; periodA=1800;periodB=2400;break;
    case 3: minDimA=40; minDimB=90; periodA=900; periodB=1600;break;
    default:minDimA=60; minDimB=80; periodA=1800;periodB=2400;break;
  }

  // --- phase offsets to break perfect sync ---
  float phaseA[3] = {0.0, 0.25, -0.18};   // small offsets for 0,2,4
  float phaseB[3] = {0.13, -0.22, 0.27};  // small offsets for 1,3,5

  // A group (fixtures 0,2,4)
  int aIdx[3] = {0,2,4};
  for(int i=0;i<3;i++){
    float v = (sin((float)t / periodA * 2 * PI + phaseA[i]*PI) + 1.0) * 0.5;
    byte dim = (byte)(minDimA + v * (255 - minDimA));
    setFixtureRGB(aIdx[i], c1.r, c1.g, c1.b, dim);
  }

  // B group (fixtures 1,3,5)
  int bIdx[3] = {1,3,5};
  for(int i=0;i<3;i++){
    float v = (sin((float)t / periodB * 2 * PI + phaseB[i]*PI) + 1.0) * 0.5;
    byte dim = (byte)(minDimB + v * (255 - minDimB));
    setFixtureRGB(bIdx[i], c2.r, c2.g, c2.b, dim);
  }
}


void patternFocusColor(int songId, int slot) {
  Color c = getSongColor(songId, slot);
  setFixtureRGB(2, c.r, c.g, c.b, 100);
  setFixtureRGB(3, c.r, c.g, c.b, 100);
  for (int i=0;i<FIXTURE_COUNT;i++) if (i!=2 && i!=3) setFixtureRGB(i,0,0,0,0);
}

void patternMent() {
  byte r = 255, g = 190, b = 55;  // LYELLOW
  int targetDim = 100;

  // 이미 켜진 상태면 계속 켜주기만
  if (mentLightActive) {
    setFixtureRGB(2, r, g, b, targetDim);
    setFixtureRGB(3, r, g, b, targetDim);
    return;
  }

  // 첫 실행 → 페이드인
  for (int dim = 0; dim <= targetDim; dim += 2) {
    setFixtureRGB(2, r, g, b, dim);
    setFixtureRGB(3, r, g, b, dim);
    delay(8);
  }

  // 유지 상태로 변환
  mentLightActive = true;
}


void patternWave(int songId, int speedPreset) {
  Color c = getSongColor(songId, 0);
  unsigned long t = millis();

  int basePeriod;
  switch(speedPreset){
    case 0: basePeriod = 3500; break;
    case 1: basePeriod = 2400; break;
    case 2: basePeriod = 1500; break;
    case 3: basePeriod = 700 / 9; break; // 3× faster
    default: basePeriod = 1500; break;
  }

  for(int i = 0; i < FIXTURE_COUNT; i++){
    float phase = (2*PI / FIXTURE_COUNT) * i;
    float v = (sin((float)t / basePeriod * 2 * PI + phase) + 1.0) * 0.5;

    // Step wave 불연속 / sweeping flash 느낌
    if (v > 0.70)       v = 1.0;
    else if (v > 0.40)  v = 0.12;
    else                v = 0.02;  // ← 거의 0으로 (VERY low)

    // 어두운 바닥 5 유지 → 완전 암흑 아니고 최소 잔광 정도
    byte dim = (byte)(0 + v * 255);

    setFixtureRGB(i, c.r, c.g, c.b, dim);
  }
}



void patternBlink(int songId, int slot) {
  Color c = getSongColor(songId, slot);
  unsigned long t = millis();

  float phase = sin(t * 0.18);  // 빠름

  byte dim = (phase > 0.0) ? 255 : 0; // 완전 ON/OFF

  for (int i=0;i<FIXTURE_COUNT;i++)
    setFixtureRGB(i,c.r,c.g,c.b,dim);
}


void patternOff(){ setAllRGB(0,0,0,0); }

// ===== Setup =====
void setup(){
  // Serial.begin(115200);
  // Serial.setTimeout(2);
  dmx_master.enable();
  dmx_master.setChannelRange(1,DMX_MASTER_CHANNELS,0);
  pinMode(RXEN_PIN,OUTPUT);
  digitalWrite(RXEN_PIN,HIGH);
  randomSeed(analogRead(A0));
  // Serial.println("DMX OK - palette + per-fixture test");
}

// ===== Loop =====
void loop(){
  
  
  // --- robust serial parse: supports "150\\n" and raw 0~255 ---
  // --- robust serial parse: supports "150\n" and raw 0~255 ---
  static char ibuf[8];
  static uint8_t ipos = 0;
  static int lastAbletonValue = -1;

  // while (Serial.available())
  // {
  //   int b = Serial.read();

  //   // DEBUG: raw byte incoming
  //   Serial.print("[RX BYTE] ");
  //   Serial.print(b);
  //   Serial.print(" ('");
  //   Serial.write(b);
  //   Serial.println("')");

  //   if (b == '\r') continue;

  //   if (isdigit(b)) {
  //     if (ipos < sizeof(ibuf) - 1) {
  //       ibuf[ipos++] = (char)b;
  //     }
  //   }
  //   else if (b == '\n') {
  //     if (ipos > 0) {
  //       ibuf[ipos] = '\0';
  //       abletonValue = atoi(ibuf);

  //       // DEBUG
  //       if (abletonValue != lastAbletonValue) {
  //         Serial.print("[PARSED STRING] ");
  //         Serial.println(abletonValue);
  //         lastAbletonValue = abletonValue;
  //       }
  //       ipos = 0;
  //     }
  //   }
  //   else if (b >= 0 && b <= 255) {
  //     // RAW BYTE MODE
  //     abletonValue = b;

  //     if (abletonValue != lastAbletonValue) {
  //       Serial.print("[PARSED RAW] ");
  //       Serial.print(abletonValue);
  //       Serial.print(" (0x");
  //       Serial.print(abletonValue, HEX);
  //       Serial.println(")");
  //       lastAbletonValue = abletonValue;
  //     }

  //     ipos = 0;
  //   }
  // }

  abletonValue = 1;


  currentSong    = 0;
  currentPattern = abletonValue;



  switch(currentPattern){
    case 0:   patternOff(); break;

    //============when you sleep============
    case 1:   patternGroupedBreathPreset(0, 2); break;
    

    //==============Tsukuru==========
    case 10: patternFocusColor(1, 0); break;
    case 11: patternGroupedBreathPreset(1, 1); break;
    case 12: patternGroupedBreathPreset(1, 0); break;
    case 13: patternGroupedBreathPreset(1, 2); break;
    case 14: patternGroupedBreathPreset(1, 3); break;
    case 15: patternBlink(1, 1); break;
    case 16: solidForTsukuru(); break;
    case 17: patternFocusColor(1, 0); break;
    case 18: 
      hayakuStart = millis(); 
      patternHayakuBreath(1); 
      break;

    //=============kuni===================
    case 20: patternGroupedBreathPreset(2, 1); break;
    case 21: patternWave(2, 3); break;
    case 22: patternFocusColor(2, 1); break;
    case 23: patternGroupedBreathPreset(2, 3); break;
    case 24: solidForTsukuru(); break;
    case 25: patternBlink(2, 0); break;

    //==============Seamless===============
    case 30: patternSolid(3); break;
    case 31: patternGroupedBreathPreset(3, 2); break;
    case 32: blueSolidForSeamless(1); break;
    case 33: blueBreathForSeamless(2); break;
    case 34: blueSolidForSeamless(0); break;
    case 35: lmixBreathForSeamless(); break;
    case 36: mixBreathForSeamless(); break;
    case 37: blueBreathForSeamless(3); break;
    case 38: patternWave(3, 3); break;
    case 39: yellowSolidForSeamless(); break;

    //=================DP=====================
    case 40: patternFocusColor(4, 1); break;
    case 41: patternSolid(4); break;
    case 42: patternSingleBreathPreset(4, 0, 0); break;
    case 43: patternSingleBreathPreset(4, 1, 0); break;
    case 44: patternOff(); break;

    //================yours=================
    case 52: patternGroupedBreathPreset(5, 1); break; 
    //케이스11로대체

    //===============maybe someday==========
    case 60: patternFocusColor(6, 0); break;
    case 61: patternGroupedBreathPreset(6, 3); break;
    case 62: patternGroupedBreathPreset(6, 1); break;

    //==============chowchow===============
    case 70: patternGroupedBreathPreset(7, 1); break;

    //==============Pink===============
    case 81: patternFocusColor(8, 0); break;
    case 82: patternBlink(8, 1); break;
    case 83: patternSolid(8); break;

    //==========Be quiet and Drive=========
    case 90: patternFocusColor(9, 0); break;
    case 91: patternGroupedBreathPreset(9, 3); break;
    case 92: patternSingleBreathPreset(9, 0, 1); break;
    case 93: patternSingleBreathPreset(9, 1, 2); break;

    //============Dead Forever===============
    case 100: patternGroupedBreathPreset(10, 1); break;

    //=============Violet===============
    case 110: patternGroupedBreathPreset(11, 2); break;

    //============Lights off===============
    case 122: patternGroupedBreathPreset(12, 1); break;

    //==========beautiful world=============
    case 130: patternFocusColor(13, 0); break;
    case 131: patternGroupedBreathPreset(13, 1); break;
    case 132: patternGroupedBreathPreset(13, 2); break;
    case 133: patternSolid(13); break;
    //===========Youth Rebellion===========
    case 140: patternFocusColor(14, 0); break;
    case 141: patternGroupedBreathPreset(14, 2); break;
    case 142: patternGroupedBreathPreset(14, 3); break;
    case 143: patternSolid(14); break;
    case 144: patternWave(14, 2); break;
    case 145: patternWave(14, 3); break;
    //===============mention==============
    case 150: patternFocusColor(15, 0); break;
    case 151: patternSolid(15); break;

    case 255: fadeOutAll(1500); break;

    default: patternOff(); break;
  }
  //Serial.print("currentPattern="); Serial.println(currentPattern);
  //delay(200);
  dmx_master.breakAndContinue();
}
