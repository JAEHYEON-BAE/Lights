# Known Issues — 코드·주석·설계 불일치 점검 결과

> **상태: 미수정 (기록 전용)**
> 이 문서는 발견된 문제를 기록하고 수정 방향을 계획하기 위한 것이며, 아래 항목은 아직 어느 것도 코드에 반영되지 않았습니다.

| 항목 | 내용 |
|---|---|
| 점검일 | 2026-10-16 |
| 기준 커밋 | `be2744f` (Fix: README) |
| 점검 범위 | `arduino/lighting_controller/lighting_controller.ino`, `lighting-controller/src/**` 전체, `README.md`, `HOW_IT_WORKS*.md` |
| 점검 방법 | 정적 코드 리딩. **실기·실행 재현은 하지 않았음** — 각 항목의 "검증" 절차로 재현 후 수정할 것 |
| 줄 번호 | 기준 커밋 시점 기준. 코드가 바뀌면 함수명을 기준으로 찾을 것 |

---

## 요약

| 우선순위 | # | 문제 | 위치 |
|---|---|---|---|
| **높음** | [1](#1-연결-직후-하드웨어가-앱-화면과-다른-색을-냄) | 연결 직후 하드웨어가 앱 화면과 다른 색을 냄 | `serial-bridge.js` |
| | [2](#2-fadeengine의-페이드가-취소되지-않아-새-장면을-덮어씀) | 진행 중인 페이드가 취소되지 않아 새 장면을 덮어씀 | `fade-engine.js`, `store.js` |
| | [3](#3-장면에-저장된-fade_in_ms가-무시됨) | 장면에 저장된 `fade_in_ms`가 무시됨 | `store.js` `recallScene` |
| | [4](#4-simulate-모드의-disconnect-버튼이-동작하지-않음) | Simulate 모드의 Disconnect 버튼이 동작하지 않음 | `serial-bridge.js`, `SettingsScreen.jsx` |
| **중간** | [5](#5-color-이펙트의-크로스페이드가-빠져-있음) | Color 이펙트의 크로스페이드가 빠져 있음 | `effect-engine.js` |
| | [6](#6-메트로놈과-조명의-박자-동기화가-보장되지-않음) | 메트로놈과 조명의 박자 동기화가 보장되지 않음 | `App.jsx`, `metronome-engine.js` |
| | [7](#7-펌웨어-주석에-적힌-대기-중-수신-처리가-구현되어-있지-않음) | 펌웨어 주석에 적힌 "대기 중 수신 처리"가 구현되어 있지 않음 | `.ino` |
| | [8](#8-heartbeat-통계가-넘치고-dmx_running이-항상-1) | Heartbeat 통계가 8비트에서 넘치고, `dmx_running`이 항상 1 | `.ino` |
| | [9](#9-조명-채널-프리셋을-펌웨어가-무시함) | 조명 채널 프리셋을 펌웨어가 무시하고, 주소 정보가 두 곳에 따로 있음 | `.ino`, `FixtureEditorScreen.jsx` |
| | [10](#10-사용자-지정-fixtures-파일-경로-처리) | 사용자 지정 fixtures 파일 경로가 저장·유지되지 않음 | `main/index.js`, `SettingsScreen.jsx` |
| | [11](#11-setlist-항목-직접-이동과-자동-진행의-동작-차이) | Setlist 항목으로 바로 이동할 때와 자동으로 넘어갈 때 동작이 다름 | `bpm-engine.js` |
| **낮음** | [12](#12-펌웨어-주석) – [20](#20-show-화면의-곡-길이-표시) | 주석·문서 표기, 입력 검증, 중복 코드 | 여러 곳 |

---

## A. 실제 동작에 영향 (높음)

### 1. 연결 직후 하드웨어가 앱 화면과 다른 색을 냄

- **위치**: `lighting-controller/src/main/serial-bridge.js` 108–113행 `_broadcastFullState()`
- **현상**
  - 연결 직후 하는 일이 "마지막으로 전송한 값(`currentState`)을 전송 대기값(`pendingState`)에 덮어쓰고 다시 보내기"임.
  - 그런데 renderer의 `setFixture`는 연결 전에도 bridge의 `pendingState`를 계속 갱신함. 따라서 아래 경우에 사용자가 지정한 색이 버려짐.
    - 앱을 켜고 색을 정한 뒤 연결하는 경우
    - Simulate 모드로 준비하다가 실제 포트에 연결하는 경우 (Simulate 중에는 `_sendFrame()`이 일찍 반환하므로 `currentState`가 갱신되지 않음)
  - 결과적으로 하드웨어는 초기값(디머 254, 검정)을 받고, 화면의 `StageVisualizer`(`outputState`)는 지정한 색을 표시함. 문서가 내세운 "미리보기는 실제 전송값의 거울" 원칙이 깨짐.
- **의도**: 연결되는 순간 "지금 켜져 있어야 할 상태"를 하드웨어에 전부 보내는 것.
- **수정 계획**
  1. `_broadcastFullState()`가 `pendingState`는 그대로 두고 `dirtyFlags.fill(true)`만 하도록 변경.
  2. 재연결할 때도 같은 함수를 쓰므로 이 한 곳만 고치면 됨.
- **검증**: `monitor.js`를 가짜 Arduino로 띄움. 색 지정 → Simulate 시작·정지 → 실제 연결 순서로 진행했을 때 첫 프레임에 지정한 RGB가 실리는지 확인.

### 2. FadeEngine의 페이드가 취소되지 않아 새 장면을 덮어씀

- **위치**: `lighting-controller/src/renderer/src/engines/fade-engine.js` 26–27행. `stop()`/`stopAll()`이 정의되어 있으나 프로젝트 어디서도 호출하지 않음.
- **현상**
  - Cue A(페이드 3초)에서 GO를 누르고 곧바로 Cue B(페이드 0)로 넘어가면, A의 페이드가 남은 시간 동안 16ms마다 값을 계속 씀. 결국 조명은 **B가 아니라 A의 최종 색**에서 멈춤.
  - 다음 경우에도 같은 일이 생김.
    - 페이드 중에 그 조명에 이펙트를 걸 때: 두 엔진이 번갈아 값을 써서 깜빡임.
    - 페이드 중에 Live 화면에서 색을 직접 바꿀 때
    - Show가 끝나 모든 조명을 0으로 만들 때 (`App.jsx` `onShowEnd`)
- **의도**: 조명 값을 쓰는 주체는 마지막에 내려진 명령 하나여야 함.
- **수정 계획**
  1. `store.js` `recallScene`의 즉시 전환 경로(204–209행)에서 `effectEngine.clearAll()`과 함께 `fadeEngine.stopAll()` 호출.
  2. 페이드 경로에서는 이번에 이펙트를 받는 조명과 이펙트를 잃는 조명만 골라 `fadeEngine.stop(id)` 호출.
  3. 이펙트 적용(LiveScreen `applyToSelected`), `onShowEnd`, `onBreakpoint`, 조명 OFF 토글 때도 해당 조명의 페이드를 멈춤.
  4. (장기) store에 "이 조명에 지금 값을 쓰는 주체" 개념을 두어, 쓰는 주체가 바뀌면 이전 주체를 자동으로 해제하도록 함.
- **검증**: 페이드 3000ms cue 다음에 페이드 0 cue를 두고 연속으로 GO → 최종 색이 두 번째 cue의 색인지 확인.

### 3. 장면에 저장된 `fade_in_ms`가 무시됨

- **위치**: `lighting-controller/src/renderer/src/store.js` 141–146행
  ```js
  recallScene: (sceneId, fadeMs = 0) => {
    ...
    const duration = fadeMs ?? scene.fade_in_ms ?? 0
  ```
- **현상**
  - 기본 매개변수가 0이라 `fadeMs`는 절대 `undefined`가 되지 않음. 따라서 `?? scene.fade_in_ms`가 실행되지 않음.
  - Scene Browser에서 저장한 장면은 기본 페이드가 500ms이고(`SceneBrowserScreen.jsx` 57행) 카드에도 "500ms"로 표시되지만, 불러오면(129·147·163행, 인자 없이 호출) 즉시 바뀜.
  - Live 화면에서 저장한 장면은 기본값이 0(`LiveScreen.jsx` 92행). 저장하는 곳에 따라 기본값이 다름.
- **의도**: `HOW_IT_WORKS`에는 "장면을 불러오면 그 장면의 `fade_in_ms`에 따라 페이드하고, cue의 페이드 시간이 있으면 그것이 우선한다"고 되어 있음.
- **수정 계획**
  1. 기본값 `= 0`을 제거해서, 인자를 주지 않으면 장면의 값을 쓰게 함.
  2. cue와 segment에서는 "비워 두면 장면 값을 따름"을 `null`로, "명시적 즉시 전환"을 `0`으로 구분. UI에 placeholder로 장면의 기본값을 표시.
  3. 장면을 새로 저장할 때의 기본 페이드 값을 한 상수로 통일.
- **주의**: 지금까지 즉시 전환되던 Scene Browser 동작이 500ms 페이드로 바뀜. 기존 `resources/scenes/*.json`의 값을 먼저 확인할 것.

### 4. Simulate 모드의 Disconnect 버튼이 동작하지 않음

- **위치**
  - `lighting-controller/src/renderer/src/screens/SettingsScreen.jsx` 59–61행 `handleDisconnect` → `window.api.disconnect()`
  - `lighting-controller/src/main/serial-bridge.js` 70–77행 `disconnect()`
- **현상**
  - Simulate 중에는 연결된 것으로 표시되므로 Disconnect 버튼이 보임. 그런데 `disconnect()`는 Simulate를 처리하지 않음.
    - `_simHeartbeat` 타이머가 계속 돔.
    - `simulateMode`가 `true`로 남음.
    - 실제 포트가 없으니 `close` 이벤트도, `disconnected` 이벤트도 오지 않아 UI는 계속 "Simulate mode"로 표시됨.
  - 이 상태에서 실제 포트에 연결하면 `_sendFrame()`이 `simulateMode` 때문에 바로 반환하므로 **실제 연결에서도 아무것도 전송되지 않음.**
- **수정 계획**
  1. `disconnect()`가 Simulate 상태면 `stopSimulate()`를 호출.
  2. `connect()`도 시작할 때 Simulate 상태를 정리.
  3. UI에서는 Simulate 중에 Disconnect 대신 Stop 버튼 하나만 노출.
- **검증**: Start Simulate → Disconnect → 상태 표시줄이 "Not connected"가 되는지, 이후 실제 포트에 연결했을 때 `monitor.js`에 패킷이 들어오는지 확인.

---

## B. 설계 의도와 어긋남 (중간)

### 5. Color 이펙트의 크로스페이드가 빠져 있음

- **위치**: `lighting-controller/src/renderer/src/engines/effect-engine.js`
  - Color 이펙트 정의(10–18행): `init`으로 색을 한 번 정하고, `tick()`은 `[]`를 반환함.
  - `setFixtureEffect`(154–162행): 이펙트를 걸 때 항상 `init` 실행.
  - 크로스페이드의 이전 이펙트 출력 계산(236–251행)
- **현상**: 크로스페이드는 매 tick의 결과를 섞는 방식인데, Color 이펙트는 tick 결과가 없음.
  - (a) 다른 상태에서 Color 이펙트로 들어갈 때: `init`이 목표 색을 바로 써 버려서 **즉시 바뀜.**
  - (b) Color 이펙트에서 다른 이펙트로 나갈 때: 이전 출력이 없어 `{0,0,0,0}`으로 간주되므로 **검정을 거쳐** 밝아짐.
  - (c) Sine Pulse와 Strobe의 `init`도 크로스페이드 중에 목표 색을 즉시 써서, 첫 tick 전에 약 16ms 동안 번쩍일 수 있음.
- **의도**: 커밋 `3a4dbd4` "이펙트 간 진정한 크로스페이드 구현". 모든 이펙트 전환이 매끄러워야 함.
- **수정 계획**
  1. Color 이펙트의 `tick()`이 매 프레임 `{id, r, g, b, dimmer}`를 반환하도록 변경.
  2. 크로스페이드 중(`envelope < 1`)에는 `setFixtureEffect`가 `init`을 실행하지 않도록 함.
  3. `static` 플래그는 "매 프레임 다시 보낼 필요 없음"이라는 최적화 의미로만 유지.
- **검증**: Color(빨강) 장면 ↔ Sine Pulse(파랑) 장면을 페이드 2000ms로 번갈아 불러와, 검정을 거치거나 즉시 바뀌는 구간이 없는지 육안 확인.

### 6. 메트로놈과 조명의 박자 동기화가 보장되지 않음

- **위치**
  - `lighting-controller/src/renderer/src/App.jsx` 77–93행 `onStateUpdate`
  - `lighting-controller/src/renderer/src/engines/metronome-engine.js` 31–39행 `updateBpm`
- **현상**: 조명 전환은 `performance.now()`를, 메트로놈은 AudioContext 시계를 기준으로 각자 시작하며, 두 시계를 맞추는 장치가 없음.
  - 시작할 때부터 메트로놈이 50ms 늦게 시작함(`currentTime + 0.05`).
  - 직전 곡과 BPM이 같은 곡으로 넘어가면 `updateBpm`이 바로 반환함. 그래서 새 곡의 첫 박에 맞춰 다시 정렬되지 않음.
  - `skipForward`/`skipBack`은 조명 타임라인만 다시 정렬하고 메트로놈은 정렬하지 않음.
  - 공연 중에 볼륨을 바꾸거나 메트로놈을 끄면 반영되지 않음. `start()` 시점에만 적용되고, 끄기는 다음 상태 변화가 있어야 반영됨.
- **의도**: Settings 화면 설명 "Plays a click sound in sync with the show BPM".
- **수정 계획**
  1. BpmEngine이 segment나 곡을 시작할 때 "기준 시각(`performance.now()` 값)과 박 위치"를 함께 전달.
  2. `MetronomeEngine`에 `alignTo(perfTimestamp, beatIndex)`를 추가해 AudioContext 시각으로 바꿔 다시 정렬. `ctx.getOutputTimestamp()`로 두 시계를 대응시킬 수 있음.
  3. `metronomeEnabled`와 `metronomeVolume`을 store 구독으로 즉시 반영.

### 7. 펌웨어 주석에 적힌 "대기 중 수신 처리"가 구현되어 있지 않음

- **위치**: `arduino/lighting_controller/lighting_controller.ino` 82–87행 `dmxWriteByte()`
  - 주석: `Sends one byte; drains incoming PC serial while waiting for UDRE1.`
  - 실제로는 `while (!(UCSR1A & (1 << UDRE1))) {}` — 송신 레지스터가 비기를 기다리기만 함.
- **현상**: `loop()`는 DMX 프레임 하나를 끝까지 보내는 동안 다른 일을 하지 못함. 그동안 PC에서 오는 바이트는 HardwareSerial 수신 버퍼(기본 64바이트)에 쌓임.

  | 구성 | DMX 프레임 송신 중 대기 시간 | 그동안 도착 가능한 바이트 (115200 baud) |
  |---|---|---|
  | 8대 (56채널, 현재) | 약 2.6ms | 약 30바이트 → 버퍼 안에 들어감 |
  | 32대 (224채널) | 약 10ms | 약 115바이트 → **64바이트 버퍼 초과 가능** |

  - 32대 모두에 이펙트가 걸리면 PC는 약 22ms마다 192바이트를 보냄(시리얼 대역폭의 약 73%).
  - 버퍼가 넘치면 바이트가 유실되고, 파서가 재동기화하면서 패킷을 버림. 대략 17–18대를 넘으면서 위험해짐.
- **수정 계획** (둘 중 선택)
  - **방법 A**: 파서를 `parseByte(b)`로 분리하고, `dmxWriteByte`의 대기 루프 안에서 `Serial.available()`을 확인해 한 바이트씩 처리. 주석이 의도한 동작이며 변경 범위가 작음.
  - **방법 B**: DMX 송신을 UDRE1 인터럽트 방식으로 바꿔 `loop()`가 막히지 않게 함. 구조적으로 더 깔끔함.
  - 제안: A로 먼저 해결하고, 32대 운용이 실제로 필요해질 때 B를 검토.
- **검증**: `fixtureMap`과 `DMX_CHANNELS`를 32대 기준으로 바꾼 뒤 전체 조명에 Color Wave를 걸고, heartbeat의 `errorCount`가 0으로 유지되는지 확인.

### 8. Heartbeat 통계가 넘치고, `dmx_running`이 항상 1

- **위치**: `arduino/lighting_controller/lighting_controller.ino` 160–171행 `sendHeartbeat()`
- **현상**
  - `packetCount & 0xFF`로 하위 8비트만 보냄. 8대 모두에 이펙트가 걸리면 초당 44 × 8 = 352개라 255를 넘고, 상태 표시줄에 "96pkt"처럼 엉뚱한 값이 보임.
  - `dmx_running` 자리(3번째 바이트)는 항상 상수 `0x01`. `0xFD` 리셋 중이거나 DMX 출력이 꺼져 있어도 1임.
- **의도**: 문서에는 "초당 레이트"와 "DMX 동작 여부"를 PC에 알려 주는 용도로 되어 있음.
- **수정 계획**
  1. 비어 있는 6–7번째 바이트(현재 `0x00`)를 써서 `packetCount`를 16비트로 전송. 패킷 길이 8바이트는 그대로라 하위 호환 유지.
  2. `dmxEnabled` 플래그를 두고 `dmxDisable()`/`dmxEnable()`에서 갱신해 실제 상태를 보고.
  3. `serial-bridge.js` `_handleIncoming`, `monitor.js`, `arduino_test.py`, `HOW_IT_WORKS*.md`를 함께 갱신.

### 9. 조명 채널 프리셋을 펌웨어가 무시함

- **위치**
  - `arduino/lighting_controller/lighting_controller.ino` `CHANNELS_PER_FIX 7`, 133–146행 `setFixture()`, 41–53행 `fixtureMap`
  - `lighting-controller/src/renderer/src/screens/FixtureEditorScreen.jsx` 4–21행 `FIXTURE_PRESETS`
- **현상**
  - 에디터에서 3ch, 4ch, 8ch 프리셋을 고를 수 있지만, 펌웨어는 모든 조명을 "디머·R·G·B·strobe·mode·speed" 순서로 씀.
    - 3ch 조명이라면 디머 값이 R 채널에 들어감.
    - 8ch(RGBA) 조명이라면 앰버 자리에 strobe 값 0이 들어감.
  - 앱에서 고친 `dmx_base`는 하드웨어로 전달되지 않음. 실제 주소는 펌웨어에 하드코딩된 `fixtureMap`이 정함. 같은 정보가 두 곳에 따로 있어서 어긋날 수 있음.
  - 기본 펌웨어는 `fixtureMap`의 0–7번만 채워져 있고 `DMX_CHANNELS`가 56이라, 앱·프로토콜·펌웨어가 모두 32대를 전제로 하지만 9번째 조명부터는 펌웨어를 수정하고 다시 플래시해야 함.
- **수정 계획** (둘 중 선택)
  - **방법 A (작음)**: 에디터에서 7ch 이외의 프리셋을 막거나 "펌웨어 미지원" 경고를 표시. `dmx_base`가 펌웨어 `fixtureMap`과 일치해야 한다는 안내를 넣음.
  - **방법 B (근본적)**: 프로토콜에 설정 명령을 추가함. 예를 들어 `0xFC` 명령으로 `[id][base_hi][base_lo][layout]`을 보냄. 연결할 때 PC가 `fixtures.json` 기준으로 주소 맵과 채널 배치를 Arduino에 내려 주고, 펌웨어는 이를 EEPROM에 저장. 이렇게 하면 "32대로 늘리려면 다시 플래시해야 한다"는 제약도 함께 해소됨.

### 10. 사용자 지정 fixtures 파일 경로 처리

- **위치**
  - `lighting-controller/src/renderer/src/screens/SettingsScreen.jsx` 23행 `fixturePath`(useState), 63–71행 `handleLoadFixtures`
  - `lighting-controller/src/main/index.js` 98–109행 `file:load-fixtures` / `file:save-fixtures`
- **현상**
  - (a) 경로를 컴포넌트 상태에만 보관해서, 앱을 재시작하면 기본 파일로 돌아감.
  - (b) Fixture Editor에서 저장하면 항상 `resourcesDir/fixtures.json`, 즉 **기본 파일에 덮어씀.** 공연별 장비 파일을 고친 줄 알았는데 기본 파일이 바뀌는 셈.
  - (c) 파일을 불러오면 `store.loadFixtures`가 `outputState`를 0으로 초기화하지만, 하드웨어에는 아무것도 보내지 않음. 그래서 미리보기와 실제 조명이 어긋남.
- **의도**: `HOW_IT_WORKS`에는 "앱 번들 외부의 공연별 장비 파일을 가리킬 때 사용한다"고 되어 있음.
- **수정 계획**
  1. main process에 "활성 fixtures 경로"를 두고 `userData`에 영속화.
  2. `file:save-fixtures`도 그 경로로 저장.
  3. 불러온 뒤에는 blackout 후 전체 상태를 다시 전송하거나, 이전 상태를 id 기준으로 유지(현재 `saveFixtures`가 쓰는 방식).

### 11. Setlist 항목 직접 이동과 자동 진행의 동작 차이

- **위치**: `lighting-controller/src/renderer/src/engines/bpm-engine.js`
  - 직접 이동: 49–55행 `jumpToSetlistItem` → 178–196행 `_processCurrentSetlistItem`
  - 자동 진행: 143–176행 `_advanceSetlist`
- **현상**: 같은 일을 하는 함수가 두 개인데 동작이 다름.
  - 직접 이동으로 breakpoint에 가면 breakpoint에 지정한 장면(`item.scene_id`)을 불러오지 않음. 장면이 없는 breakpoint의 "흰색 50%" 처리는 콜백에서 하므로 양쪽 모두 동작함.
  - 빈 곡으로 이동하면 `_currentSetlistIndex`만 바뀌고 상태는 그대로 남음. 자동 진행에서는 빈 곡을 건너뜀.
- **수정 계획**: `jumpToSetlistItem`이 위치를 정한 뒤 `_advanceSetlist()`를 호출하도록 합쳐서 경로를 하나로 만들고, `_processCurrentSetlistItem` 제거.

---

## C. 주석·문서 불일치 및 작은 문제 (낮음)

### 12. 펌웨어 주석

- 111행 `// Start code + 512 channels` — 실제로는 `DMX_CHANNELS`(56)개만 보냄.
- 56행 `[1..512] = channel values` — 버퍼 크기는 `DMX_CHANNELS + 1` = 57.
- 8–9행 패킷 설명과 `HOW_IT_WORKS`의 "모든 명령은 정확히 6바이트" — blackout(`0xFE`)과 reset(`0xFD`) 명령은 PC가 5바이트로 보냄(`serial-bridge.js` 96·104행).
- **계획**: 주석을 `DMX_CHANNELS` 기준으로 고치고, 문서에 "제어 명령은 5바이트"를 명시.

### 13. `serial-bridge.js` Simulate 주석

- 160행 `Simulate mode: no real serial port, just echoes packets back as fake heartbeats` — 실제로는 패킷을 되돌려 보내지 않고, 0으로 고정된 heartbeat(`packetCount: 0, errorCount: 0`)만 만듦.
- **계획**: 주석을 실제 동작에 맞게 수정. 원래 의도를 살리려면 대기 중인 dirty 패킷 수를 세어 `packetCount`로 보내 주는 방법도 있음.

### 14. `bpm-engine.js` `skipBack` 주석

- 63행 `Restart current segment, or go back to previous segment` — 실제로는 항상 이전 segment로 감. 첫 segment일 때만 그 segment를 다시 시작함.
- **계획 (결정 필요)**
  - 일반적인 동작으로 구현: 현재 segment 시작 후 일정 시간(예: 1마디) 안이면 이전 segment로, 아니면 현재 segment를 처음부터.
  - 또는 주석만 실제 동작에 맞게 수정.

### 15. Blackout 기능

- `serial-bridge.js` 92–99행 `setBlackout()`이 IPC(`main/index.js`)와 preload에 노출되어 있지 않아 사용할 방법이 없는 코드임.
- 게다가 blackout을 해제하면 `_sendFrame()`이 바뀐 조명(dirty)만 다시 보내므로, 그동안 바뀌지 않은 조명은 꺼진 채로 남음.
- **계획 (결정 필요)**
  - 살릴 경우: IPC·preload·UI(비상 blackout 버튼)에 노출하고, 해제 시 #1에서 고친 전체 재전송을 호출.
  - 제거할 경우: 코드와 문서에서 함께 삭제.
  - 의견: 실제 공연 장비로는 비상 blackout 버튼이 있는 편이 바람직함.

### 16. Fixture Editor 검증과 README

- `FixtureEditorScreen.jsx` 86–89행: 새 조명 ID가 `max + 1`이라 32 이상도 만들 수 있음. `serial-bridge.js` 80행이 32 이상을 조용히 버림.
- `dmx_base + 채널 수 − 1 ≤ 512` 검증이 없음. 겹침 검사(49–66행)만 있음.
- 저장하지 않은 편집 내용이 있어도 다른 화면으로 이동할 때 경고하지 않음. `dirtyScreen` 가드는 `ShowScreen.jsx`에만 구현되어 있음.
- `README.md` 117행 "Changes are saved to disk immediately" — 실제로는 Save 버튼을 눌러야 저장됨(`handleSave`).
- **계획**: ID 상한(0–31)과 512 범위 검증 추가, 편집 시 `setDirtyScreen('fixtures')` 호출, README 문구를 실제 동작에 맞게 수정.

### 17. 단축키 목록과 연결 표시 점

- `SettingsScreen.jsx` 197–200행: 단축키 목록에 cue 단축키(Enter/Backspace)만 있고 Show 화면 단축키(→, ←, Enter로 재개)가 없음.
- `Sidebar.jsx` 33행: 연결 점이 Simulate 중에도 초록색. 문서에는 "Arduino 연결 시 초록"이라고 되어 있고, StatusBar는 Simulate를 보라색으로 구분함.
- **계획**: 단축키 목록에 Show 단축키 추가, Sidebar 점 색을 StatusBar와 같은 규칙으로 통일.

### 18. `outputState`의 값 범위

- `store.js` 45–52행 `setFixture`: R·G·B를 0–255 그대로, 반올림 없이 `outputState`에 기록함. 실제 전송값은 `serial-bridge.js` 79–90행에서 0–254로 제한되고 반올림됨.
- 미리보기 화면에서는 눈에 띄지 않지만, "실제 전송값의 거울"이라는 원칙과는 1단위 어긋남.
- **계획**: store의 `setFixture`에서 bridge와 같은 방식으로 제한·반올림한 값을 기록.

### 19. 구조 관련

- `migrateScene`이 `main/index.js` 3–20행과 `store.js` 3–21행에 중복되어 있음. main 쪽은 `import` 문보다 위에 놓여 있음.
- renderer가 `window.api.onError`를 구독하지 않아(`App.jsx` 104–108행) 시리얼 쓰기 오류가 화면에 보이지 않음.
- `main/index.js` 52–56행: bridge 이벤트 리스너를 `createWindow()` 안에서 등록함. macOS에서 창을 닫았다 다시 열면,
  - bridge는 연결된 채로 남지만 새 renderer는 "Not connected"로 시작함.
  - 리스너가 창을 만들 때마다 누적됨.
- **계획**
  - 마이그레이션은 main 쪽으로 일원화.
  - `onError`는 Toast로 표시.
  - 창을 다시 만들 때 `bridge.connected`를 조회해 renderer 상태를 동기화하고, 리스너는 앱 단위에서 한 번만 등록.

### 20. Show 화면의 곡 길이 표시

- `ShowScreen.jsx` 391·724–725·736행: 곡 길이와 마디 합계에 무한 segment의 `bars`(기본 8)가 포함되어 실제보다 길게 나옴.
- **계획**: 무한 segment는 합계에서 제외하고 "+ ∞"로 표시.

---

## 진행 순서 제안

| 단계 | 묶음 | 이유 |
|---|---|---|
| PR 1 | #1, #2, #3, #4 | 공연 중 오동작과 직결되고, 각각 수정 범위가 작음 |
| PR 2 | #5, #11, #14, #20 | 이펙트·Show 엔진 내부 로직 정리 |
| PR 3 | #6 | 시계 동기화는 설계 판단이 필요해 따로 다루는 편이 나음 |
| PR 4 | #7, #8, #12, #13, #15 | 펌웨어·프로토콜 변경. `monitor.js`, `arduino_test.py`, 문서를 함께 갱신해야 함 |
| PR 5 | #9, #10, #16 | 장비 설정 구조 개편. #9의 방법 A/B 선택에 따라 범위가 크게 달라짐 |
| PR 6 | #17, #18, #19 | 정리 작업 |

## 결정이 필요한 사항

- [ ] **#9**: 프리셋을 막는 작은 수정(A) vs PC가 펌웨어 설정을 내려 주는 프로토콜 확장(B)
- [ ] **#14**: 뒤로 건너뛰기(`skipBack`)의 동작을 바꿀지, 주석만 고칠지
- [ ] **#15**: Blackout 기능을 살려서 UI에 노출할지, 제거할지
- [ ] **#7**: 수신 처리를 대기 루프 안에서 하는 방식(A)과 인터럽트 방식(B) 중 어느 쪽으로 할지

## 진행 현황

| # | 상태 | PR |
|---|---|---|
| 1–20 | 미수정 | — |
