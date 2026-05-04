# How the Lighting Controller Works

이 문서는 프로젝트의 모든 파일이 어떻게 구성되어 하나의 완성된 시스템을 이루는지 설명합니다.

---
## Big Picture

시스템은 USB 케이블로 연결된 두 개의 물리적 구성 요소로 이루어져 있습니다:

```
[PC — Electron App] ──USB Serial 115200 baud──► [Arduino Mega] ──DMX512──► [Stage Lights]
```

- **PC 앱**에는 모든 지능이 담겨 있습니다: 색상 선택, scene, cue list, effect.
- **Arduino**는 단순한 중계기입니다. PC로부터 간단한 5바이트 색상 패킷을 받아 DMX 값을 조명에 전달할 뿐이며, scene이나 effect에 대해서는 아무것도 알지 못합니다.
- **DMX512**는 무대 조명이 사용하는 산업 표준 protocol입니다. RS-485 케이블을 통해 512개의 channel 값을 전송합니다.

---
## Project Layout

```
Lights/
├── arduino/
│   └── lighting_controller.ino   ← Arduino firmware
├── lighting-controller/          ← Electron 데스크톱 앱
│   ├── src/
│   │   ├── main/                 ← Electron main process (Node.js)
│   │   ├── preload/              ← IPC bridge
│   │   └── renderer/             ← React UI
│   └── resources/
│       ├── fixtures.json         ← 조명 기기 정의
│       ├── cue-list.json         ← 저장된 공연 cue list
│       └── scenes/               ← 저장된 scene당 하나의 JSON 파일
└── standalone_lighting_control_pipeline.md   ← 설계 참조 문서
```

---
## The Arduino Firmware (`arduino/lighting_controller.ino`)

Arduino Mega 2560에 플래시되는 firmware입니다.

### What it does

1. PC로부터 USB를 통해 115200 baud로 **5바이트 패킷을 수신**합니다.
2. `fixtureMap` 조회 테이블을 사용하여 **각 패킷을 DMX channel 쓰기로 변환**합니다.
3. PC가 Arduino의 상태를 알 수 있도록 매 초마다 **heartbeat를 PC로 전송**합니다.

### The serial packet format

PC가 전송하는 모든 색상 명령은 정확히 5바이트입니다:

```
[0xFF] [fixture_id] [R] [G] [B]
```

- `0xFF`는 Arduino에게 "새 패킷이 시작된다"는 것을 알리는 시작 마커입니다.
- `fixture_id`는 0–31 범위로, 업데이트할 조명을 식별합니다.
- `R`, `G`, `B`는 0–255 범위의 밝기 값입니다.

두 가지 특수 `fixture_id` 값이 존재합니다:
- `0xFE` → **Blackout**: 모든 DMX channel을 즉시 0으로 설정합니다.
- `0xFD` → **Reset**: DMX master를 재시작합니다(오류 복구에 사용).

### The parser state machine

Arduino는 `loop()`에서 바이트를 하나씩 읽습니다. 간단한 state machine (`STATE_WAIT_START` → `STATE_READ_ID` → `STATE_READ_R` → `STATE_READ_G` → `STATE_READ_B`)이 각 패킷을 조립합니다. 예상치 못한 위치에서 `0xFF`를 만나면(패킷이 손상된 경우) 새 시작 바이트로 처리하여 재동기화합니다.

### The fixture map

```cpp
uint16_t fixtureMap[MAX_FIXTURES] = {
  1,  // Fixture 0 → DMX channels 1, 2, 3
  4,  // Fixture 1 → DMX channels 4, 5, 6
  ...
};
```

이 테이블은 논리적인 fixture ID(0–31)를 DMX base channel로 매핑합니다. 각 RGB 조명 기기는 3개의 연속 channel을 사용합니다. **이 테이블은 PC 측의 `resources/fixtures.json`과 반드시 일치해야 합니다** — 이 둘은 동일한 fixture 정의의 두 반쪽입니다.

### The heartbeat

매 1000ms마다 Arduino는 8바이트를 PC로 전송합니다:
```
[0xAA] [0x01] [dmx_running] [packet_count] [error_count] [0] [0] [0]
```
PC가 이를 모니터링합니다. 3초 동안 heartbeat가 도착하지 않으면 앱은 "응답 없음" 경고를 표시합니다.

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

**Event forwarding** — SerialBridge가 이벤트를 emit합니다(예: `connected`, `heartbeat`, `blackout`). 이 파일은 그 이벤트들을 `win.webContents.send(channel, data)`를 사용하여 renderer 창으로 전달합니다.

### File storage paths

개발 환경(`npm run dev`): 파일은 `lighting-controller/resources/`에서 읽힙니다.

패키징된 앱(`.dmg` / `.exe`): 파일은 앱 번들 내부의 `process.resourcesPath/resources/`에서 읽힙니다.

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

**Simulate mode** — Arduino 하드웨어가 없는 경우, `startSimulate()`가 bridge를 가짜 연결 상태로 만듭니다. frame loop는 계속 실행되지만(동일한 코드 경로가 실행됨) 실제 `port.write()` 호출은 건너뜁니다. 매 초마다 가짜 heartbeat가 emit됩니다. 이를 통해 하드웨어 없이도 scene, cue, effect를 개발하고 테스트할 수 있습니다.

**Heartbeat watcher** — 별도의 `setInterval`이 매 초마다 최근 3초 내에 실제 heartbeat가 수신되었는지 확인합니다. 수신되지 않으면 `heartbeat-timeout` 이벤트를 emit하고, main process가 이를 renderer로 전달합니다.

---
## The Preload Script (`src/preload/index.js`)

Electron의 보안 모델은 renderer(브라우저)가 Node.js API를 직접 호출하는 것을 허용하지 않습니다. preload 스크립트는 양쪽 모두에 접근할 수 있는 특수 컨텍스트에서 실행되는 얇은 bridge입니다.

`contextBridge.exposeInMainWorld('api', {...})`를 사용하여 renderer의 JavaScript 환경에 안전한 `window.api` 객체를 부착합니다. `window.api`의 모든 메서드는 `ipcRenderer.invoke(...)`(renderer → main 호출용) 또는 `ipcRenderer.on(...)`(main → renderer 이벤트용)의 래퍼에 불과합니다.

renderer가 수행할 수 있는 작업의 전체 목록입니다:

```
Serial actions:  listPorts, startSimulate, stopSimulate, connect, disconnect,
                 setFixture, setBlackout, reset, isConnected
Serial events:   onConnected, onDisconnected, onError, onHeartbeat,
                 onHeartbeatTimeout, onBlackout
File actions:    loadFixtures, loadScenes, saveScene, deleteScene,
                 loadCueList, saveCueList
```

---
## Renderer: The React App

`src/renderer/src/` 안의 모든 것이 사용자가 상호작용하는 React UI입니다.

### App entry (`main.jsx` → `App.jsx`)

`main.jsx`는 단순한 React 진입점으로, HTML 페이지에 `<App />`을 마운트합니다.

`App.jsx`는 루트 컴포넌트입니다. 시작 시 세 가지 중요한 작업을 수행합니다:

1. **엔진 생성** — `FadeEngine`과 `EffectEngine`이 여기서 인스턴스화되고 앱 언마운트 시 소멸됩니다.
2. **초기 데이터 로드** — 시작 시 한 번 `window.api.loadFixtures()`, `window.api.loadScenes()`, `window.api.loadCueList()`를 호출하여 Zustand store를 채웁니다.
3. **시리얼 이벤트 리스너 등록** — `onConnected`, `onDisconnected`, `onHeartbeat`, `onHeartbeatTimeout`을 수신하여 store로 라우팅합니다.

또한 **전역 키보드 단축키**를 등록합니다:
- `Space` → blackout 전환
- `Enter` → 다음 cue로 이동
- `Backspace` → 이전 cue로 이동

레이아웃 구조: 왼쪽에 `<Sidebar>`, 상단에 `<StatusBar>`, 그리고 `store.activeScreen` 값에 따라 메인 영역에 5개 화면 중 하나가 표시됩니다.

---
## State Management (`src/renderer/src/store.js`)

모든 공유 state는 하나의 **Zustand** store에 있습니다. Zustand는 최소한의 React state 라이브러리로, `useStore(s => s.someField)`로 읽고 action을 호출하여 업데이트합니다.

store는 다음 섹션으로 나뉩니다:

| 섹션 | 보유 내용 |
|---|---|
| **Connection** | `connected`, `connectedPort`, `simulateMode`, `heartbeat`, `heartbeatTimeout` |
| **Fixtures** | `fixtures`(정의), `fixtureState`(현재 색상, `{[id]: {r,g,b}}` 형태) |
| **Groups** | fixtures.json에서 로드된 group 정의 |
| **Blackout** | `blackoutActive` flag |
| **Master Dimmer** | `masterDimmer`(0.0–1.0 배율) |
| **Scenes** | `scenes` 배열, `activeSceneId` |
| **Cue List** | `cueList` 객체, `currentCueIndex` |
| **Engines** | `fadeEngine` 참조 |
| **Active Effect** | `activeEffect`, `effectParams` |
| **UI** | `activeScreen`(5개 화면 중 표시 중인 화면) |

### The central write path

`setFixtureColor(id, r, g, b)`는 조명 색상을 바꾸고 싶은 앱의 모든 부분에서 호출됩니다. 이 함수는:
1. React의 `fixtureState`를 업데이트합니다(UI가 다시 렌더링됨).
2. `window.api.setFixture(id, r*dimmer, g*dimmer, b*dimmer)`를 호출하여 명령을 main process로 전송합니다(Arduino로 전달됨).

**master dimmer**는 이 시점에 적용됩니다. store는 "실제" 색상을 저장하지만, dimmer가 적용된 색상만 Arduino로 전송됩니다.

---
## The Engines

### Fade Engine (`src/renderer/src/engines/fade-engine.js`)

시간에 따른 부드러운 색상 전환을 처리합니다. `recallScene`이 `fade_in_ms`가 0이 아닌 값으로 호출되면, 즉시 전환하는 대신 이 엔진을 사용합니다.

16ms(약 60fps)마다 자체 `setInterval`을 실행합니다. 각 활성 fade에 대해 **cubic ease-in-out** 곡선을 사용하여 시작 색상에서 끝 색상으로 보간한 뒤, 중간 값을 `setFixtureColor`로 전달합니다. fade가 완료되면 해당 fixture를 활성 fade map에서 제거합니다.

### Effect Engine (`src/renderer/src/engines/effect-engine.js`)

시간에 따라 변하는 RGB 값을 생성하여 애니메이션 조명 effect를 만듭니다. 이 엔진도 16ms마다 `setInterval`을 실행합니다.

각 effect는 순수한 `tick(fixtures, time, params)` 함수로 정의됩니다 — fixture ID 목록, 경과 시간(밀리초), 파라미터가 주어지면 `{id, r, g, b}` 결과 배열을 반환합니다. 엔진은 매 tick마다 이 결과로 `setFixtureColor`를 호출합니다.

5가지 내장 effect는 다음과 같습니다:

| Effect | 설명 |
|---|---|
| **Color Chase** | 한 번에 하나의 fixture만 켜지며, 활성 fixture가 지정된 speed로 순환합니다. |
| **Sine Pulse** | 모든 fixture가 사인파를 따라 밝기가 함께 맥동합니다. |
| **Color Wave** | 각 fixture 사이에 설정 가능한 위상 오프셋을 두고 전체 무지개 색조 사이클이 fixture들을 가로질러 전파됩니다. |
| **Strobe** | 모든 fixture가 지정된 speed로 켜졌다 꺼졌다를 반복합니다. |
| **Random Flicker** | fixture들이 독립적으로 깜빡여 불이나 촛불을 시뮬레이션합니다. 결정론적 seed를 사용하므로 단순한 무작위 노이즈가 아닙니다. |

---
## The Five Screens

### Live Control (`screens/LiveControlScreen.jsx`)

메인 퍼포먼스 화면입니다. fixture당 하나씩 **fixture 타일** 그리드를 표시합니다. 각 타일의 배경색은 해당 fixture의 현재 색상을 반영합니다. 타일을 클릭하면 `ColorPicker` 모달이 열립니다.

상단에는 **group 선택 버튼**이 있으며, group을 선택하고 "Set Group Color"를 누르면 해당 group의 모든 fixture에 동일한 색상이 적용됩니다.

**FLASH 버튼**은 누르고 있는 동안 모든 fixture에 완전한 흰색(`255, 255, 255`)을 임시로 전송하고, 뗄 때 이전 blackout 상태를 복원합니다.

### Scene Browser (`screens/SceneBrowserScreen.jsx`)

저장된 조명 상태의 라이브러리입니다. 각 scene 카드는 **썸네일** — scene의 처음 8개 fixture를 작은 색상 그리드로 보여줍니다.

**scene 저장**은 store의 현재 `fixtureState` 스냅샷을 찍고, 이름을 입력받아 `window.api.saveScene()`을 통해 `resources/scenes/<scene_id>.json`에 씁니다. scene ID는 타임스탬프(`scene_<Date.now()>`)입니다.

**scene 불러오기**(더블클릭 또는 GO 클릭)는 `store.recallScene(sceneId)`를 호출하며, scene의 `fade_in_ms` 설정에 따라 모든 fixture 색상을 즉시 변경하거나 fade 전환합니다. scene 카드를 우클릭하면 Recall과 Delete 옵션이 있는 컨텍스트 메뉴가 열립니다.

### Cue List (`screens/CueListScreen.jsx`)

순서대로 공연을 재생하는 도구입니다. **cue list**는 각 cue가 scene과 fade 시간, cue 번호를 연결하는 순서가 있는 표입니다.

**GO 버튼**(또는 `Enter` 키)은 `currentCueIndex`를 증가시키고 다음 cue의 scene을 불러옵니다. **BACK**(또는 `Backspace`)은 한 cue 뒤로 돌아갑니다. 표의 아무 행이나 클릭하면 해당 cue로 바로 이동합니다.

cue 이름은 더블클릭으로 편집할 수 있습니다. 연결된 scene과 fade 시간은 인라인으로 편집 가능합니다. 모든 변경사항은 `window.api.saveCueList()`를 통해 `cue-list.json`에 즉시 저장됩니다.

### Effect Engine (`screens/EffectEngineScreen.jsx`)

라이브 퍼포먼스용 effect 패널입니다. 왼쪽 열에 5개의 내장 effect 목록이 있습니다. effect를 선택하면 메인 패널에 파라미터(speed, 색상, 위상 오프셋)가 표시됩니다.

**group 선택기**는 effect가 적용될 fixture를 결정합니다 — "All Fixtures" 또는 이름이 있는 group. **START**를 클릭하면 `effectEngine.current.start(key, fixtureIds, params)`가 호출됩니다. effect가 실행 중일 때 파라미터를 변경하면 엔진이 새 파라미터로 즉시 재시작되므로, 멈추지 않고도 효과가 실시간으로 업데이트됩니다.

### Settings (`screens/SettingsScreen.jsx`)

하드웨어 연결 설정 화면입니다.

**Serial connection** — 감지된 모든 시리얼 포트를 나열합니다. 포트를 선택하고 Connect를 클릭합니다. 연결은 `window.api.connect(port)` → IPC → `SerialBridge.connect()`를 통해 진행됩니다.

**Simulate mode** — Arduino가 없다면 "Start Simulate"로 가짜 연결 모드를 활성화하여 하드웨어 없이도 앱의 모든 기능(scene, cue, effect)을 사용할 수 있습니다.

**Fixture configuration** — 다른 파일 경로에서 커스텀 `fixtures.json`을 로드하거나 기본 파일을 다시 로드할 수 있습니다. 다른 조명 장비로 앱을 재설정하는 방법입니다.

---
## Shared UI Components

### Sidebar (`components/Sidebar.jsx`)

5개의 아이콘 버튼이 있는 좁은 왼쪽 내비게이션 열입니다. 클릭 시 `store.setActiveScreen(id)`를 호출합니다. 상단의 작은 점은 Arduino에 연결되면 초록색으로 빛납니다.

### StatusBar (`components/StatusBar.jsx`)

앱 상단을 가로지르는 얇은 바입니다. 다음을 표시합니다:
- **Connection dot**: 회색 = 연결 안 됨, 초록색 = 연결됨, 보라색 = simulate mode, 노란색(맥동) = heartbeat 타임아웃.
- **Heartbeat 통계**: 마지막 Arduino heartbeat의 패킷 수와 오류 수.
- **BLACKOUT** 텍스트(빨간색, 맥동): blackout이 활성화된 경우.
- **Master Dimmer 슬라이더**: `store.setMasterDimmer(value)`를 호출하는 range 입력. master dimmer를 변경하면 새 값으로 스케일된 현재 fixture 색상이 즉시 다시 전송됩니다.

### ColorPicker (`components/ColorPicker.jsx`)

네 가지 입력 방식이 있는 모달 color picker입니다:
- **Hue 슬라이더** — 무지개 그라디언트 range 입력(0–359°).
- **Saturation 및 Brightness 슬라이더** — HSV 컨트롤.
- **R/G/B 슬라이더** — 직접 channel 컨트롤(각각 0–255).
- **Hex 입력** — 색상 코드 직접 입력.
- **Preset 스와치** — 빠른 접근을 위한 12가지 일반 색상.

네 가지 입력은 동기화 상태를 유지합니다. 내부적으로 HSV(hue, saturation, value)로 state를 저장하고, 변경될 때마다 RGB로 변환하여 `onChange(r, g, b)`를 호출합니다 — 최종적으로 `store.setFixtureColor()`를 호출합니다.

### BlackoutButton (`components/BlackoutButton.jsx`)

화면 오른쪽 가장자리에 항상 표시되는 큰 버튼입니다. `store.toggleBlackout()`을 호출하며, `window.api.setBlackout()`을 통해 Arduino에 `0xFE` 특수 명령을 전송합니다. 동일한 blackout 전환이 전역적으로 `Space` 키에 바인딩되어 있습니다.

---
## Data Files (`resources/`)

### `fixtures.json`

물리적인 조명 장비를 정의합니다. 각 fixture는 다음을 포함합니다:
- `id` — 모든 패킷에서 사용되는 논리적 ID(0–31). Arduino의 `fixtureMap[]`과 일치해야 합니다.
- `name` — UI에 표시되는 사람이 읽기 쉬운 레이블.
- `dmx_base` — 조명 기기의 물리적 DMX 시작 channel(기기의 DIP 스위치로 설정).
- `group` — 일괄 제어를 위한 group 이름.

group도 이 파일에서 정의되며, group 선택 버튼에 표시될 내용을 제어합니다.

### `scenes/scene_<timestamp>.json`

저장된 각 scene은 별도의 파일입니다. scene은 다음을 저장합니다:
- `scene_id`, `name`, `fade_in_ms`, `fade_out_ms`
- `fixtures` — scene이 저장된 시점의 모든 fixture에 대한 `{id, r, g, b}` 스냅샷 배열.

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
3. LiveControlScreen이 store.setFixtureColor(id, r, g, b)를 호출합니다
        ↓
4. store.js가 fixtureState를 업데이트 → React가 새 배경색으로 FixtureTile을 다시 렌더링합니다
   store.js가 window.api.setFixture(id, r*dimmer, g*dimmer, b*dimmer)를 호출합니다
        ↓
5. preload/index.js: ipcRenderer.invoke('serial:set-fixture', id, r, g, b)
        ↓  [IPC 경계 — renderer에서 main process로 교차]
6. main/index.js: ipcMain.handle('serial:set-fixture', ...)가 bridge.setFixture(id, r, g, b)를 호출합니다
        ↓
7. serial-bridge.js: pendingState[id]를 업데이트하고, dirtyFlags[id] = true로 설정합니다
        ↓  [다음 44Hz 프레임 tick, ~0–22ms 후]
8. serial-bridge.js: _sendFrame()이 dirty flag를 감지하고, 패킷 [0xFF, id, r, g, b]를 조립하여
   시리얼 포트에 씁니다
        ↓  [USB 시리얼, ~0.4ms]
9. Arduino: 5바이트를 수신하고, parser가 패킷을 조립하여
   setFixture(id, r, g, b)를 호출합니다
        ↓
10. Arduino: dmx_master.setChannelValue(dmxBase, r) — g, b도 동일하게 처리합니다
        ↓  [DMX512 프레임, ~22.7ms]
11. 무대 조명: DMX channel 값을 수신하여 색상을 변경합니다
```

슬라이더 드래그부터 조명 변경까지의 end-to-end 지연 시간: **50ms 미만**.
