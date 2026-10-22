# How the Lighting Controller Works

이 문서는 프로젝트의 모든 파일이 어떻게 구성되어 하나의 완성된 시스템을 이루는지 설명합니다.

---
## Big Picture

시스템은 USB 케이블로 연결된 두 개의 물리적 구성 요소로 이루어져 있습니다:

```
[PC — Electron App] ──USB Serial 115200 baud──► [Arduino Mega] ──DMX512──► [Stage Lights]
```

- **PC 앱**에는 모든 지능이 담겨 있습니다: 색상 선택, scene, cue list, effect.
- **Arduino**는 단순한 중계기입니다. PC로부터 간단한 6바이트 색상 패킷을 받아 DMX 값을 조명에 전달할 뿐이며, scene이나 effect에 대해서는 아무것도 알지 못합니다.
- **DMX512**는 무대 조명이 사용하는 산업 표준 protocol입니다. RS-485 케이블을 통해 512개의 channel 값을 전송합니다.

---
## Project Layout

```
Lights/
├── arduino/
│   └── lighting_controller/
│       └── lighting_controller.ino   ← Arduino firmware
├── arduino_test.py               ← 프로토콜 테스트 스크립트 (실제 Arduino 필요)
├── lighting-controller/          ← Electron 데스크톱 앱
│   ├── monitor.js                ← 시리얼 패킷 모니터 / 가짜 Arduino
│   ├── src/
│   │   ├── main/                 ← Electron main process (Node.js)
│   │   ├── preload/              ← IPC bridge
│   │   └── renderer/             ← React UI
│   ├── resources-default/        ← 앱에 동봉되는 초기 기본값
│   └── resources/                ← 로컬 공연 데이터 (gitignore 대상)
│       ├── fixtures.json         ← 조명 기기 정의
│       ├── cue-list.json         ← 저장된 공연 cue list
│       ├── scenes/               ← 저장된 scene당 하나의 JSON 파일
│       └── shows/                ← BPM-sync show당 하나의 JSON 파일
```

---
## The Arduino Firmware (`arduino/lighting_controller/lighting_controller.ino`)

Arduino Mega 2560에 플래시되는 firmware입니다.

### What it does

1. PC로부터 USB를 통해 115200 baud로 **6바이트 패킷을 수신**합니다.
2. `fixtureMap` 조회 테이블을 사용하여 **각 패킷을 DMX channel 쓰기로 변환**합니다.
3. PC가 Arduino의 상태를 알 수 있도록 매 초마다 **heartbeat를 PC로 전송**합니다.

### The serial packet format

PC가 전송하는 모든 색상 명령은 정확히 6바이트입니다:

```
[0xFF] [fixture_id] [D] [R] [G] [B]
```

- `0xFF`는 Arduino에게 "새 패킷이 시작된다"는 것을 알리는 시작 마커입니다.
- `fixture_id`는 0–31 범위로, 업데이트할 조명을 식별합니다.
- `D`는 개별 디머 값으로 0–254 범위입니다.
- `R`, `G`, `B`는 0–254 범위의 색상 값입니다.

PC는 **모든** 데이터 바이트를 0–254로 클램프합니다(`serial-bridge.js`). 따라서 `0xFF`는
오직 시작 바이트 위치에만 나타날 수 있으며, 이것이 재동기화가 가능한 이유입니다 —
데이터 자리의 `0xFF`는 언제나 실제 값이 아니라 바이트 유실을 뜻합니다.

두 가지 특수 `fixture_id` 값이 존재합니다:
- `0xFE` → **Blackout**: 모든 DMX channel을 즉시 0으로 설정합니다.
- `0xFD` → **Reset**: DMX master를 재시작합니다(오류 복구에 사용).

### The parser state machine

Arduino는 `loop()`에서 바이트를 하나씩 읽습니다. 간단한 state machine (`STATE_WAIT_START` → `STATE_READ_ID` → `STATE_READ_DIMMER` → `STATE_READ_R` → `STATE_READ_G` → `STATE_READ_B`)이 각 패킷을 조립합니다. 예상치 못한 위치에서 `0xFF`를 만나면(패킷이 손상된 경우) 새 시작 바이트로 처리하여 재동기화합니다.

### The fixture map

```cpp
uint16_t fixtureMap[MAX_FIXTURES] = {
  1,  // Fixture 0 → DMX channels 1–7
  8,  // Fixture 1 → DMX channels 8–14
  ...
};
```

이 테이블은 논리적인 fixture ID(0–31)를 DMX base channel로 매핑합니다. 각 fixture는 7개의 연속 channel을 사용합니다(dimmer, red, green, blue, strobe, mode, speed). **이 테이블은 PC 측의 `resources/fixtures.json`과 반드시 일치해야 합니다** — 이 둘은 동일한 fixture 정의의 두 반쪽입니다.

### The heartbeat

매 1000ms마다 Arduino는 8바이트를 PC로 전송합니다:
```
[0xAA] [0x01] [dmx_running] [packet_count] [error_count] [0] [0] [0]
```
PC가 이를 모니터링합니다. 5초 동안 heartbeat가 도착하지 않으면 앱은 "응답 없음" 경고를 표시합니다.

---
## The Electron App

Electron은 웹 기술(HTML, CSS, JavaScript)을 사용하여 데스크톱 애플리케이션을 만들 수 있게 해주는 프레임워크입니다. 두 개의 별도 JavaScript 환경을 동시에 실행합니다:

- **Main process** — 완전한 Node.js 환경입니다. 파일 시스템, USB 시리얼 포트, OS API에 접근할 수 있습니다.
- **Renderer process** — 샌드박스 처리된 Chromium 브라우저 탭입니다. React UI가 실행되는 곳입니다.

이 두 프로세스는 서로의 코드를 직접 호출할 수 없습니다. **IPC**(Inter-Process Communication)라는 메시지 전달 시스템을 통해 통신합니다.

---
## Main Process (`src/main/index.js`)

앱의 Node.js 측 진입점입니다.

### What it registers

**Serial IPC handlers** — renderer가 `window.api.connect(port)`를 호출하면, IPC를 통해 여기의 `ipcMain.handle('serial:connect', ...)`로 전달되고, SerialBridge를 호출합니다.

**File IPC handlers** — `fixtures.json`, scene 파일, `cue-list.json`은 모두 이곳에서 읽고 씁니다. renderer는 파일 시스템에 직접 접근하지 않습니다.

**Event forwarding** — SerialBridge가 이벤트를 emit합니다(`connected`, `disconnected`, `error`, `heartbeat`, `heartbeat-timeout`). 이 파일은 그 다섯 가지를 `win.webContents.send(channel, data)`를 사용하여 renderer 창으로 전달합니다.

### File storage paths

개발 환경(`npm run dev`): 파일은 `lighting-controller/resources/`에서 읽힙니다. 이 폴더가 아직 없다면(갓 clone한 경우) 읽기 전용 `resources-default/` 폴더로 fallback합니다.

패키징된 앱(`.dmg` / `.exe`): 첫 실행 시 앱 번들의 `process.resourcesPath/resources-default/`가 `app.getPath('userData')/resources`로 복사되고, 이후 모든 읽기·쓰기는 그곳에서 이루어집니다. 따라서 공연 데이터는 앱 업데이트 후에도 유지되며 앱 번들 내부에 저장되지 않습니다.

---
## The Serial Bridge (`src/main/serial-bridge.js`)

프로젝트에서 기술적으로 가장 핵심적인 파일입니다. main process(Node.js) 내에서 전적으로 실행되며 Arduino와의 USB 시리얼 연결을 관리합니다.

### Key concepts

**Dirty flags** — 매 프레임마다 모든 fixture의 색상을 전송하는 대신, bridge는 마지막 프레임 전송 이후 변경된 fixture를 추적합니다. "dirty" 상태인 fixture만 다음 전송에 포함됩니다. 이를 통해 USB 버스가 과부하되지 않도록 합니다.

**Frame loop** — `setInterval`이 초당 44번(약 22ms마다) 실행됩니다. 매 tick마다 dirty 상태인 모든 fixture 패킷을 하나의 `Buffer`로 조립하여 시리얼 포트에 한 번에 씁니다. fixture당 하나씩 `port.write()`를 호출하는 것보다 묶어서 한 번에 쓰는 방식이 더 효율적입니다.

**Pending vs current state** — bridge는 두 개의 state 배열을 유지합니다:
- `pendingState` — renderer가 각 fixture에 *원하는* 색상.
- `currentState` — Arduino로 마지막으로 *전송된* 색상.

pending ≠ current일 때 dirty flag가 설정됩니다. frame loop는 패킷을 전송할 때 pending → current로 복사하고 flag를 지웁니다.

**Simulate mode** — Arduino 하드웨어가 없는 경우, `startSimulate()`가 bridge를 가짜 연결 상태로 만들고 매 초마다 하드코딩된 heartbeat(`dmxRunning: true, packetCount: 0, errorCount: 0`)를 emit합니다. 44Hz frame loop는 계속 돌고 `setFixture()`의 클램프·변경 감지도 그대로 동작하지만, `_sendFrame()`은 조기 반환합니다 — 바이트 직렬화가 일어나지 않고, dirty flag와 `currentState`도 갱신되지 않습니다. blackout, reset, heartbeat watcher 역시 모두 건너뜁니다.

즉 simulate mode는 renderer 전체(scene, cue, effect, BPM sync)는 검증하지만 **전송 프로토콜, Arduino parser, 장애 처리 경로는 검증하지 않습니다.** 특히 `fixtures.json`과 firmware `fixtureMap`의 불일치는 simulate mode에서 절대 드러나지 않으므로, 패치(주소 배정) 확인은 반드시 실제 하드웨어에서 해야 합니다.

**Heartbeat watcher** — 별도의 `setInterval`이 매 초마다 최근 5초(비트 5개분) 내에 실제 heartbeat가 수신되었는지 확인합니다. 수신되지 않으면 `heartbeat-timeout` 이벤트를 emit하고, main process가 이를 renderer로 전달합니다. 이는 경고일 뿐입니다 — frame loop는 계속 돌고, 조명은 마지막 상태를 유지하며, 자동 재연결도 하지 않습니다. 조치는 운영자의 판단에 맡깁니다. heartbeat가 다시 도착하면 경고는 자동으로 해제됩니다.

---
## The Preload Script (`src/preload/index.js`)

Electron의 보안 모델은 renderer(브라우저)가 Node.js API를 직접 호출하는 것을 허용하지 않습니다. preload 스크립트는 양쪽 모두에 접근할 수 있는 특수 컨텍스트에서 실행되는 얇은 bridge입니다.

`contextBridge.exposeInMainWorld('api', {...})`를 사용하여 renderer의 JavaScript 환경에 안전한 `window.api` 객체를 부착합니다. `window.api`의 모든 메서드는 `ipcRenderer.invoke(...)`(renderer → main 호출용) 또는 `ipcRenderer.on(...)`(main → renderer 이벤트용)의 래퍼에 불과합니다.

renderer가 수행할 수 있는 작업의 전체 목록입니다:

```
Serial actions:  listPorts, startSimulate, stopSimulate, connect, disconnect,
                 setFixture, reset, isConnected
Serial events:   onConnected, onDisconnected, onError, onHeartbeat,
                 onHeartbeatTimeout
File actions:    loadFixtures, saveFixtures, loadScenes, saveScene, deleteScene,
                 loadCueList, saveCueList, loadShows, saveShow, deleteShow
```

---
## Renderer: The React App

`src/renderer/src/` 안의 모든 것이 사용자가 상호작용하는 React UI입니다.

### App entry (`main.jsx` → `App.jsx`)

`main.jsx`는 단순한 React 진입점으로, HTML 페이지에 `<App />`을 마운트합니다.

`App.jsx`는 루트 컴포넌트입니다. 시작 시 세 가지 중요한 작업을 수행합니다:

1. **엔진 생성** — `FadeEngine`, `EffectEngine`, `BpmEngine`, `MetronomeEngine`이 여기서 인스턴스화되고 앱 언마운트 시 소멸됩니다. `EffectEngine`과 `BpmEngine`은 `useRef`(props로 `LiveScreen` / `ShowScreen`에 전달)와 Zustand store 양쪽에 저장되어, `recallScene` 같은 store action도 이들을 직접 구동할 수 있습니다. 모든 엔진은 store의 `setFixture`를 유일한 출력 경로로 주입받습니다.
2. **초기 데이터 로드** — 시작 시 한 번 `window.api.loadFixtures()`, `window.api.loadScenes()`, `window.api.loadCueList()`, `window.api.loadShows()`를 호출하여 Zustand store를 채웁니다.
3. **시리얼 이벤트 리스너 등록** — `onConnected`, `onDisconnected`, `onHeartbeat`, `onHeartbeatTimeout`을 수신하여 store로 라우팅합니다.

또한 **전역 키보드 단축키**를 등록합니다. 단축키는 화면에 따라 다르게 동작하며, 텍스트 입력·select·button에 포커스가 있을 때는 무시됩니다:

| 화면 | 키 | 동작 |
|---|---|---|
| `live`, `cues` | `Enter` | 다음 cue로 이동 |
| `live`, `cues` | `Backspace` | 이전 cue로 이동 |
| `show` | `Enter` / `→` | breakpoint에서 재개, 실행 중이면 다음 segment로 건너뛰기 |
| `show` | `Backspace` / `←` | 이전 segment로 건너뛰기 |

레이아웃 구조: 왼쪽에 `<Sidebar>`, 상단에 `<StatusBar>`, 메인 영역에 6개 화면 중 하나, 오른쪽에 `<StageVisualizer>` 패널(`settings`와 `fixtures` 화면에서는 숨겨짐). 일시적인 메시지는 `<Toast>` 오버레이가 처리합니다.

---
## State Management (`src/renderer/src/store.js`)

모든 공유 state는 하나의 **Zustand** store에 있습니다. Zustand는 최소한의 React state 라이브러리로, `useStore(s => s.someField)`로 읽고 action을 호출하여 업데이트합니다.

store는 다음 섹션으로 나뉩니다:

| 섹션 | 보유 내용 |
|---|---|
| **Connection** | `connected`, `connectedPort`, `simulateMode`, `heartbeat`, `heartbeatTimeout` |
| **Fixtures** | `fixtures`(정의), `fixtureState`(master dimmer 적용 전 원본 의도값, `{[id]: {d,r,g,b}}`), `outputState`(실제로 하드웨어에 전송된 값), `fixtureEnabled`(fixture별 on/off) |
| **Groups** | fixtures.json에서 로드된 group 정의 |
| **Master Dimmer** | `masterDimmer`(0.0–1.0 배율) |
| **Scenes** | `scenes` 배열, `activeSceneId` |
| **Cue List** | `cueList` 객체, `currentCueIndex` |
| **Shows (BPM sync)** | `shows`, `activeShowId`, `activeShow`, `runnerState`(진행 상태, 현재 곡/segment, BPM, 마디 진행도) |
| **Engines** | `fadeEngine`, `effectEngine`, `bpmEngine` 참조 |
| **Per-fixture Effects** | `fixtureEffects` (`{[fixtureId]: {effectKey, params}}`) |
| **Metronome** | `metronomeEnabled`, `metronomeVolume`, `metronomeDeviceId` — `localStorage`에 영속화 |
| **UI** | `activeScreen`(6개 화면 중 표시 중인 화면), `toast`, `dirtyScreen`(미저장 변경 가드) |

### The central write path

`setFixture(id, d, r, g, b)`는 조명을 바꾸는 **유일한 진입점**입니다 — color picker, 두 엔진, scene 불러오기, BPM 러너가 모두 이 함수를 거칩니다. 이 함수는:
1. `d`를 0–254로 클램프하고 `{d, r, g, b}`를 `fixtureState`에 저장합니다 — master dimmer 적용 **전**의 원본 의도값입니다.
2. fixture가 꺼져 있으면(`fixtureEnabled[id] === false`) 즉시 반환합니다. 실행 중인 effect가 운영자가 꺼둔 fixture를 되살리지 못하게 하는 장치입니다.
3. 디머에 `masterDimmer`를 곱한 뒤 `window.api.setFixture(id, scaledD, r, g, b)`를 호출합니다.
4. 방금 보낸 그 값을 `outputState`에 기록합니다.

**왜 state가 두 개인가?** `fixtureState`는 에디터가 의도한 값이고, `outputState`는 하드웨어에 실제로 전달된 값입니다. master dimmer가 100%가 아니거나 fixture가 꺼져 있으면 둘은 달라집니다. `StageVisualizer`는 `outputState`만 읽으므로, 화면의 무대는 구조적으로 실제 전송값의 거울이 됩니다 — 같은 결과를 두 번째 공식으로 다시 계산하다 어긋나는 일이 원천적으로 불가능합니다.

지켜야 할 불변식: **`window.api.setFixture()` 호출과 `outputState` 갱신은 항상 한 쌍으로 일어나야 합니다.** 현재 이 쌍은 `setFixture`와 `toggleFixtureEnabled` 두 곳에 있으며, 새로운 전송 지점을 추가할 때도 반드시 함께 유지해야 합니다.

---
## The Engines

### Fade Engine (`src/renderer/src/engines/fade-engine.js`)

시간에 따른 부드러운 색상 전환을 처리합니다. `recallScene`이 `fade_in_ms`가 0이 아닌 값으로 호출되면, 즉시 전환하는 대신 이 엔진을 사용합니다.

16ms(약 60fps)마다 자체 `setInterval`을 실행합니다. 각 활성 fade에 대해 **cubic ease-in-out** 곡선을 사용하여 디머와 R/G/B 네 값 모두를 시작에서 끝으로 보간한 뒤, 중간 값을 `setFixture`로 전달합니다. fade가 완료되면 해당 fixture를 활성 fade map에서 제거합니다.

### Effect Engine (`src/renderer/src/engines/effect-engine.js`)

시간에 따라 변하는 RGB 값을 생성하여 애니메이션 조명 effect를 만듭니다. 이 엔진도 16ms마다 `setInterval`을 실행합니다.

각 effect는 순수한 `tick(fixtures, time, params)` 함수로 정의됩니다 — fixture ID 목록, 경과 시간(밀리초), 파라미터가 주어지면 결과 배열을 반환합니다. 결과 항목은 `{id, r, g, b}`(색상 기반 effect), `{id, dimmer}`(Sine Pulse·Strobe처럼 `init`이 정한 색을 유지한 채 밝기만 바꾸는 effect), 또는 둘 다일 수 있습니다. 엔진은 매 tick마다 이 결과로 `setFixture`를 호출합니다. 정적 effect는 `static: true`를 선언하고 `init`만 구현합니다.

이전의 그룹 단위 effect 방식과 달리, 엔진은 이제 **fixture별 독립 effect 할당**을 지원합니다. 각 fixture가 서로 다른 effect(또는 정적 색상)를 동시에 실행할 수 있습니다. effect를 교체할 때는 **크로스페이드**됩니다 — 나가는 effect와 들어오는 effect가 동시에 실행되며 envelope에 따라 블렌딩되므로 튀는 순간이 없습니다.

7가지 내장 effect는 다음과 같습니다:

| Key | 이름 | 설명 |
|---|---|---|
| `color` | **Color** | 개별 디머 컨트롤이 있는 정적 단색. `init`에서 값을 한 번 정하고 `tick`은 아무것도 반환하지 않습니다. |
| `chase` | **Color Chase** | 한 번에 하나의 fixture만 켜지며, 활성 fixture가 지정된 speed로 순환합니다. |
| `sinePulse` | **Sine Pulse** | fixture들이 사인파를 따라 `minBrightness`–`maxBrightness` 사이에서 맥동하며, fixture별 위상 오프셋을 줄 수 있습니다. |
| `colorWave` | **Color Wave** | `hue1`↔`hue2` 사이의 색조 스윕(짧은 쪽/긴 쪽 선택)이 fixture들을 가로질러 전파되며, 밝기 pulse를 덧씌울 수 있습니다. |
| `colorStep` | **Color Step** | 색조를 연속으로 훑는 대신 지정된 hue 목록을 단계적으로 전환합니다. fixture별 시간 오프셋 지원. |
| `strobe` | **Strobe** | fixture들이 지정된 speed로 켜졌다 꺼졌다를 반복하며, fixture별 위상 오프셋을 줄 수 있습니다. |
| `randomFlicker` | **Random Flicker** | fixture들이 독립적으로 깜빡여 불이나 촛불을 시뮬레이션합니다. 결정론적 seed를 사용하므로 단순한 무작위 노이즈가 아닙니다. |

---
## The Six Screens

### Live Control (`screens/LiveScreen.jsx`) — screen key: `live`

메인 퍼포먼스 화면입니다. fixture당 하나씩 **fixture 타일** 그리드를 표시합니다. 각 타일의 배경색은 해당 fixture의 현재 색상을 반영합니다. 타일을 클릭하면 편집 대상으로 선택됩니다.

오른쪽 패널에는 선택된 fixture(들)에 대한 **effect 에디터**가 표시됩니다. 각 fixture에 내장 effect 중 하나(또는 정적 색상)를 독립적으로 할당할 수 있습니다. **Apply**를 클릭하면 선택된 fixture에 effect가 적용되고, **Clear**를 클릭하면 effect가 제거되어 수동 색상 제어로 돌아갑니다.

상단의 **group 선택 버튼**으로 group 내 모든 fixture를 한 번에 선택할 수 있습니다. **Save Scene** 버튼은 현재 색상과 활성 effect 할당을 스냅샷하여 이름이 붙은 scene 파일로 저장합니다.

effect가 실행 중일 때 파라미터를 변경하면 엔진이 새 값으로 즉시 업데이트되므로 멈추지 않고도 실시간으로 효과가 변경됩니다.

### Scene Browser (`screens/SceneBrowserScreen.jsx`) — screen key: `scenes`

저장된 조명 상태의 라이브러리입니다. 각 scene 카드는 **썸네일**을 보여줍니다 — scene의 fixture ID 0–7을 4×2 그리드로 배치하고, 각 색상은 디머가 반영된 값이며, effect가 걸린 fixture에는 모서리에 작은 흰 점이 표시됩니다.

**scene 저장**은 store의 현재 `fixtureState`와 fixture별 effect 할당 스냅샷을 찍고, 이름을 입력받아 `window.api.saveScene()`을 통해 `resources/scenes/<scene_id>.json`에 씁니다. scene ID는 타임스탬프(`scene_<Date.now()>`)입니다.

**scene 불러오기**(더블클릭 또는 GO 클릭)는 `store.recallScene(sceneId)`를 호출하며, scene의 `fade_in_ms` 설정에 따라 모든 fixture 색상을 즉시 변경하거나 fade 전환합니다. scene에 저장된 fixture별 effect 할당도 함께 복원됩니다. scene 카드를 우클릭하면 Recall과 Delete 옵션이 있는 컨텍스트 메뉴가 열립니다.

### Cue List (`screens/CueListScreen.jsx`) — screen key: `cues`

순서대로 공연을 재생하는 도구입니다. **cue list**는 각 cue가 scene과 fade 시간, cue 번호를 연결하는 순서가 있는 표입니다.

**GO 버튼**(또는 `Enter` 키)은 `currentCueIndex`를 증가시키고 다음 cue의 scene을 불러옵니다. **BACK**(또는 `Backspace`)은 한 cue 뒤로 돌아갑니다. 표의 아무 행이나 클릭하면 해당 cue로 바로 이동합니다.

cue 이름은 더블클릭으로 편집할 수 있습니다. 연결된 scene과 fade 시간은 인라인으로 편집 가능합니다. 모든 변경사항은 `window.api.saveCueList()`를 통해 `cue-list.json`에 즉시 저장됩니다.

### Show (`screens/ShowScreen.jsx`) — screen key: `show`

`engines/bpm-engine.js`가 구동하는 BPM 동기 재생 화면입니다.

**show**는 **song**과 **breakpoint**로 이루어진 setlist입니다. 각 song은 BPM과 박자를 가지며 **segment**들로 나뉘고, 하나의 segment는 특정 scene을 N마디(또는 무한히) 유지합니다. 한 마디는 `(60000 / BPM) × beatsPerBar` 밀리초이며, 그 시간이 지나면 엔진이 다음 segment의 scene을 불러옵니다 — 아무도 GO를 누르지 않아도 조명 전환이 박자에 맞아떨어집니다.

**breakpoint**는 setlist 중간의 멈춤 구간(멘트·휴식)입니다. 러너는 `status: 'breakpoint'` 상태로 멈추고 운영자가 `Enter`를 누를 때까지 대기합니다. breakpoint에 scene이 지정되지 않았다면 흰색 50% 디머로 대체되고, show가 끝나면 모든 fixture가 0으로 설정됩니다.

store의 `runnerState`가 엔진 상태(진행 상태, 현재 song/segment, 현재 BPM, 경과 마디)를 그대로 반영하여 UI가 진행도를 그립니다. **메트로놈**이 켜져 있으면 `MetronomeEngine`이 Web Audio API로 같은 BPM의 클릭음을 선택된 출력 장치로 내보냅니다.

show는 이 화면에서 편집하며(song·segment·breakpoint 추가/삭제/순서 변경) `resources/shows/<show_id>.json`에 저장됩니다.

### Fixture Editor (`screens/FixtureEditorScreen.jsx`) — screen key: `fixtures`

물리적인 조명 장비 구성을 관리하는 전용 화면입니다.

왼쪽 열에 정의된 모든 fixture와 group이 나열됩니다. **Add Fixture** 또는 **Add Group**을 클릭하면 오른쪽에 입력 패널이 열립니다. 기존 fixture나 group을 클릭하면 편집 모드로 열립니다.

**Fixture 필드**: 이름, 타입 프리셋(RGB PAR 3ch / 4ch / 7ch, RGBA 8ch), DMX base channel, group 할당.

**DMX 충돌 감지** — 에디터는 DMX channel 범위가 겹치는 fixture를 강조 표시하여, 하드웨어에 실제로 적용되기 전에 channel 충돌을 미리 방지합니다.

편집 패널에서 **Save**를 클릭하면 변경사항이 확정되어 `window.api.saveFixtures()`를 통해 `fixtures.json`이 디스크에 기록되고 store의 fixture 정의가 다시 로드됩니다.

### Settings (`screens/SettingsScreen.jsx`) — screen key: `settings`

하드웨어 연결 설정 화면입니다.

**Serial connection** — 감지된 모든 시리얼 포트를 나열합니다. 포트를 선택하고 Connect를 클릭합니다. 연결은 `window.api.connect(port)` → IPC → `SerialBridge.connect()`를 통해 진행됩니다.

**Simulate mode** — Arduino가 없다면 "Start Simulate"로 가짜 연결 모드를 활성화하여 하드웨어 없이도 앱의 모든 기능(scene, cue, effect)을 사용할 수 있습니다.

**Fixture configuration** — 다른 파일 경로에서 커스텀 `fixtures.json`을 로드할 수 있습니다(비워두면 기본 파일 사용). 앱 번들 외부에 위치한 fixtures 파일(예: 공연별 장비 파일)을 가리킬 때 사용합니다.

**Keyboard shortcuts** — 전역 cue 단축키 목록을 보여줍니다.

**Metronome** — 클릭음 on/off, 볼륨, 출력 오디오 장치를 설정합니다. 세 값 모두 `localStorage`에 영속화됩니다.

---
## Shared UI Components

### Sidebar (`components/Sidebar.jsx`)

6개의 아이콘 버튼(Live, Scenes, Cue List, Show, Fixtures, Settings)이 있는 좁은 왼쪽 내비게이션 열입니다. 클릭 시 `store.setActiveScreen(id)`를 호출합니다. 상단의 작은 점은 Arduino에 연결되면 초록색으로 빛납니다. 현재 화면에 미저장 변경(`dirtyScreen`)이 있으면 다른 화면으로 이동하기 전에 확인을 묻습니다.

### StatusBar (`components/StatusBar.jsx`)

앱 상단을 가로지르는 얇은 바입니다. 다음을 표시합니다:
- **Connection dot**: 회색 = 연결 안 됨, 초록색 = 연결됨, 보라색 = simulate mode, 노란색(맥동) = heartbeat 타임아웃.
- **Heartbeat 통계**: 마지막 Arduino heartbeat의 패킷 수와 오류 수. 둘 다 누적값이 아니라 **초당 레이트**입니다 — firmware가 heartbeat를 보낼 때마다 카운터를 0으로 되돌립니다.
- **"⚠ Arduino not responding"**(노란색): 실제 포트에서 5초간 heartbeat가 없을 때 표시됩니다.
- **Master Dimmer 슬라이더**: `store.setMasterDimmer(value)`를 호출하는 range 입력. master dimmer를 변경하면 새 값으로 스케일된 현재 fixture 색상이 즉시 다시 전송됩니다.

### StageVisualizer (`components/StageVisualizer.jsx`)

무대 장비의 소형 조감도로, `settings`와 `fixtures` 화면을 제외한 모든 화면의 우측 패널에 표시됩니다. fixture들은 group별로 배열되고 각 fixture 타일은 현재 색상으로 실시간 발광합니다. 사이드바 레이아웃에 맞게 크기를 줄여주는 `compact` prop을 지원합니다.

### ColorPicker (`components/ColorPicker.jsx`)

다섯 가지 입력 방식이 있는 모달 color picker입니다:
- **Hue 슬라이더** — 무지개 그라디언트 range 입력(0–359°).
- **Saturation 및 Brightness 슬라이더** — HSV 컨트롤.
- **R/G/B 슬라이더** — 직접 channel 컨트롤(각각 0–255).
- **Hex 입력** — 색상 코드 직접 입력.
- **Preset 스와치** — 빠른 접근을 위한 12가지 일반 색상.

모든 입력은 동기화 상태를 유지합니다. 내부적으로 HSV(hue, saturation, value)로 state를 저장하고, 변경될 때마다 RGB로 변환하여 `onChange(r, g, b)`를 호출합니다 — 최종적으로 `store.setFixture()`를 호출합니다.

### Toast (`components/Toast.jsx`)

`store.showToast(message)`로 구동되는 일시적 메시지 오버레이입니다. 저장 완료·오류 알림에 사용됩니다.

---
## Data Files (`resources/`)

### `fixtures.json`

물리적인 조명 장비를 정의합니다. 각 fixture는 다음을 포함합니다:
- `id` — 모든 패킷에서 사용되는 논리적 ID(0–31). Arduino의 `fixtureMap[]`과 일치해야 합니다.
- `name` — UI에 표시되는 사람이 읽기 쉬운 레이블.
- `type` — fixture 프리셋 키(예: `rgb_par_7ch`). channel 레이아웃을 정의합니다.
- `dmx_base` — 조명 기기의 물리적 DMX 시작 channel(기기의 DIP 스위치로 설정).
- `channels` — 타입 프리셋에서 파생된 channel 오프셋 맵(예: `{dimmer: 0, red: 1, green: 2, blue: 3}`).
- `group` — 일괄 제어를 위한 group 이름.

group도 이 파일에서 정의되며, group 선택 버튼에 표시될 내용을 제어합니다.

### `scenes/scene_<timestamp>.json`

저장된 각 scene은 별도의 파일입니다. scene은 다음을 저장합니다:
- `scene_id`, `name`, `fade_in_ms`, `fade_out_ms`
- `fixtures` — scene이 저장된 시점의 모든 fixture에 대한 `{id, dim, r, g, b, effect, effectParams}` 스냅샷 배열.

### `shows/show_<timestamp>.json`

BPM-sync show당 하나의 파일입니다. show는 다음을 저장합니다:
- `show_id`, `show_name`
- `songs` — `song_id` → `{name, bpm, beats_per_bar, segments}` 맵. 각 segment는 `{scene_id, bars, ...}` 형태입니다.
- `setlist` — BPM 러너가 순서대로 진행하는 song과 breakpoint의 배열.

### `cue-list.json`

전체 공연을 위한 단일 파일입니다. 다음을 포함합니다:
- `show_name` — Cue List 화면 헤더에 표시됩니다.
- `cues` — `{cue_number, name, scene_id, trigger, fade_in_ms}`의 순서 있는 배열.

`scene_id`는 cue를 scene 파일과 연결합니다. cue의 `fade_in_ms`는 scene의 기본 fade 시간을 재정의합니다.

---
## Data Flow Summary

fixture 타일에서 색상을 클릭하여 조명이 변경될 때 일어나는 일입니다:

```
1. 사용자가 ColorPicker에서 슬라이더를 드래그합니다
        ↓
2. ColorPicker가 onChange(r, g, b)를 호출합니다
        ↓
3. LiveScreen이 store.setFixture(id, d, r, g, b)를 호출합니다
        ↓
4. store.js가 fixtureState(원본)와 outputState(master dimmer 적용값)를 업데이트
   → React가 fixture 타일과 무대 시각화를 다시 렌더링합니다
   store.js가 window.api.setFixture(id, scaledD, r, g, b)를 호출합니다
        ↓
5. preload/index.js: ipcRenderer.invoke('serial:set-fixture', id, d, r, g, b)
        ↓  [IPC 경계 — renderer에서 main process로 교차]
6. main/index.js: ipcMain.handle('serial:set-fixture', ...)가 bridge.setFixture(id, d, r, g, b)를 호출합니다
        ↓
7. serial-bridge.js: pendingState[id]를 업데이트하고, dirtyFlags[id] = true로 설정합니다
        ↓  [다음 44Hz 프레임 tick, ~0–22ms 후]
8. serial-bridge.js: _sendFrame()이 dirty flag를 감지하고, 패킷 [0xFF, id, d, r, g, b]를 조립하여
   시리얼 포트에 씁니다
        ↓  [USB 시리얼, ~0.4ms]
9. Arduino: 6바이트를 수신하고, parser가 패킷을 조립하여
   setFixture(id, d, r, g, b)를 호출합니다
        ↓
10. Arduino: setChannelValue(dmxBase + CH_DIMMER, d), setChannelValue(dmxBase + CH_RED, r) — g, b도 동일하게 처리합니다
        ↓  [DMX512 프레임, ~2.6ms]
11. 무대 조명: DMX channel 값을 수신하여 색상을 변경합니다
```

DMX 프레임이 짧은 이유는 firmware가 512채널 전체가 아니라 `DMX_CHANNELS`(56)개만 전송하기
때문입니다: break 100µs + mark 12µs + 250 kbaud로 57바이트 ≈ 2.6ms이며, 따라서 `loop()`는
약 400Hz로 반복됩니다. 슬라이더 드래그부터 조명 변경까지의 end-to-end 지연 시간은
**50ms 미만**이고, 그 대부분은 다음 프레임 tick을 기다리는 0–22ms입니다.
