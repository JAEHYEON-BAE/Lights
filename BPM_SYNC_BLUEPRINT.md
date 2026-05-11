# BPM-Sync 공연 조명 시스템 Blueprint

## 1. 개요 및 목표

### 배경
현재 시스템은 수동 큐 리스트(Cue List) 기반으로, 운영자가 매번 GO 버튼을 눌러야 장면이 전환됩니다.  
실제 무대 공연에서는 **곡의 BPM에 맞춰 조명이 자동으로 전환**되어야 하며, 멘트(Intermission) 구간에서만 수동 개입이 필요합니다.

### 목표
- 각 곡에 **BPM + 마디(bar) 단위**로 조명 장면(Scene)을 편집
- 공연 시작 시 조명이 BPM에 맞춰 **자동 전환**
- **Breakpoint(멘트 구간)**에서 자동 일시정지, 운영자가 "다음" 누르면 재개
- 곡이 바뀔 때 **BPM이 자동으로 갱신**되어 다음 곡 sync에 맞게 동작

---

## 2. 핵심 개념 정의

| 용어 | 정의 |
|------|------|
| **Song** | BPM과 박자(시그니처)를 가진 곡 단위. 여러 Segment로 구성 |
| **Segment** | 한 Song 안에서 특정 Scene을 N마디 동안 유지하는 단위 |
| **Setlist** | Song과 Breakpoint가 순서대로 나열된 공연 전체 순서 |
| **Breakpoint** | 멘트/휴식 등 자동 진행이 멈추는 구간. 운영자 수동 트리거로 재개 |
| **Bar** | 마디. 한 마디 = `(60000ms / BPM) × 박자수(beats per bar)` |
| **BPM Engine** | BPM 기반 타이머로 Segment 자동 전환을 담당하는 엔진 |
| **Show** | Setlist + Songs 전체를 하나로 묶은 공연 단위 파일 |

---

## 3. 데이터 모델 설계

### 3-1. Show 파일 구조 (`resources/shows/{show_id}.json`)

```json
{
  "version": "1.0",
  "show_id": "show_1745000000000",
  "show_name": "2026 정기공연",
  "songs": {
    "song_1": {
      "song_id": "song_1",
      "name": "첫 번째 곡",
      "bpm": 120,
      "beats_per_bar": 4,
      "segments": [
        {
          "segment_id": "seg_1",
          "scene_id": "scene_1778000000001",
          "bars": 8,
          "fade_in_ms": 250
        },
        {
          "segment_id": "seg_2",
          "scene_id": "scene_1778000000002",
          "bars": 16,
          "fade_in_ms": 500
        }
      ]
    },
    "song_2": {
      "song_id": "song_2",
      "name": "두 번째 곡",
      "bpm": 140,
      "beats_per_bar": 4,
      "segments": [
        {
          "segment_id": "seg_1",
          "scene_id": "scene_1778000000003",
          "bars": 4,
          "fade_in_ms": 0
        }
      ]
    }
  },
  "setlist": [
    { "type": "song",       "song_id": "song_1" },
    { "type": "breakpoint", "breakpoint_id": "bp_1", "name": "멘트 1" },
    { "type": "song",       "song_id": "song_2" }
  ]
}
```

### 3-2. 기존 Cue List와의 관계

- 기존 `cue-list.json` / `CueListScreen`은 **그대로 유지** (수동 큐 진행용)
- Show 시스템은 **완전히 별도의 데이터 파일 + 화면**으로 추가
- 두 시스템은 같은 Scene 라이브러리를 공유함

---

## 4. 시스템 아키텍처

```
ShowRunnerScreen (운영자 뷰)
  ├── BpmEngine (신규)
  │   ├── 현재 BPM 유지, 마디 타이머 루프
  │   ├── Segment 자동 전환 → store.recallScene() 호출
  │   ├── Song 종료 → 다음 Setlist 항목으로 자동 이동
  │   └── Breakpoint 도달 → 일시정지 상태, 수동 트리거 대기
  ├── ShowEditorScreen (편집 뷰)
  │   ├── Song 편집 (BPM, 박자, Segment 목록)
  │   └── Setlist 편집 (순서 변경, Breakpoint 삽입)
  └── Zustand Store (신규 슬라이스)
      ├── shows[], activeShowId
      ├── runnerState: { status, currentSetlistIndex, currentSegmentIndex, elapsedBars, ... }
      └── show CRUD + IPC persistence
```

---

## 5. 신규 컴포넌트 목록

### 5-1. 엔진: `BpmEngine` (`src/renderer/src/engines/bpm-engine.js`)

**역할:** BPM 기반 마디 카운팅 + Segment/Song 자동 전환

```
클래스 BpmEngine
  ├── constructor(onRecallScene, onBreakpoint, onShowEnd)
  ├── load(show)              — Show 데이터 로드
  ├── start()                 — Setlist 처음부터 시작
  ├── resume()                — Breakpoint 이후 수동 재개
  ├── stop()                  — 전체 정지
  ├── jumpToSetlistItem(i)    — 특정 Setlist 항목으로 점프
  └── _tick()                 — setInterval 16ms 루프
      ├── 현재 Bar 시간 계산: barDurationMs = (60000 / bpm) * beats_per_bar
      ├── 경과 마디 수 = Math.floor(elapsedMs / barDurationMs)
      ├── 경과 마디 >= 현재 Segment.bars → advanceSegment()
      └── advanceSegment()
          ├── 다음 Segment 있음 → recallScene() + 타이머 리셋
          ├── 다음 Segment 없음 (Song 끝) → advanceSetlist()
          └── advanceSetlist()
              ├── 다음 항목 = song → BPM 갱신 + 첫 Segment 시작
              └── 다음 항목 = breakpoint → 일시정지 + onBreakpoint() 콜백
```

**타이밍 정확도:**
- `setInterval` 대신 `performance.now()` 기반 drift 보정 사용
- 각 tick에서 `(performance.now() - segmentStartTime)`으로 절대 경과시간 계산
- 인터벌 지터에 영향받지 않음

### 5-2. 화면: `ShowEditorScreen` (`src/renderer/src/screens/ShowEditorScreen.jsx`)

**역할:** Show + Song + Segment 편집

**레이아웃:**
```
┌─────────────────────────────────────────────────────────┐
│  Show: [공연명 입력]                    [저장] [삭제]    │
├──────────────────────────┬──────────────────────────────┤
│  SETLIST                 │  SONG EDITOR                 │
│  ┌────────────────────┐  │  Song: [곡명]                │
│  │ ▶ Song: 첫 번째 곡 │  │  BPM: [120]  박자: [4]/4    │
│  │   [멘트 1 삽입]    │  │                              │
│  │ ▶ Song: 두 번째 곡 │  │  Segments:                   │
│  │   [+ Song 추가]    │  │  ┌──────┬──────┬────────┐   │
│  └────────────────────┘  │  │Scene │ Bars │FadeMs  │   │
│                          │  ├──────┼──────┼────────┤   │
│                          │  │[선택]│  [8] │ [250]  │   │
│                          │  │[선택]│ [16] │ [500]  │   │
│                          │  │    [+ Segment 추가]   │   │
│                          │  └──────────────────────┘   │
└──────────────────────────┴──────────────────────────────┘
```

### 5-3. 화면: `ShowRunnerScreen` (`src/renderer/src/screens/ShowRunnerScreen.jsx`)

**역할:** 공연 실시간 운영 뷰

**레이아웃:**
```
┌─────────────────────────────────────────────────────────┐
│  ♩ BPM: 120          현재 곡: 첫 번째 곡                │
├─────────────────────────────────────────────────────────┤
│  SETLIST                     현재 Segment 진행          │
│  ✓  첫 번째 곡               ████████░░░░░░░░  5/8 bars │
│  ▶  멘트 1              [Scene: 조용한 블루]             │
│     두 번째 곡          다음: [비트 레드] (3마디 후)     │
│                                                         │
│         [■ STOP]    [◀ 이전]    [▶▶ 다음]              │
│                                                         │
│  ━━━━━━━━━━━━━━━━━━━━ BREAKPOINT ━━━━━━━━━━━━━━━━━━━━  │
│          멘트 1 (대기중...)        [▶ GO]               │
└─────────────────────────────────────────────────────────┘
```

**상태 표시:**
- `running` — BPM 타이머 자동 진행 중, 마디 프로그레스바 표시
- `breakpoint` — 멘트 구간 대기, GO 버튼 강조 표시
- `stopped` — 공연 종료 또는 수동 정지

---

## 6. Store 확장 설계 (`src/renderer/src/store.js`)

```javascript
// 신규 슬라이스 추가
{
  // Show 데이터
  shows: [],                          // 로드된 모든 show 목록
  activeShowId: null,
  activeShow: null,                   // 현재 편집/실행 중인 show 객체

  // Runner 상태 (BpmEngine이 업데이트)
  runnerState: {
    status: 'stopped',                // 'stopped' | 'running' | 'breakpoint' | 'ended'
    currentSetlistIndex: -1,
    currentSongId: null,
    currentSegmentIndex: -1,
    currentBpm: 0,
    elapsedBarsInSegment: 0,
    totalBarsInSegment: 0,
    segmentStartTime: null,
  },

  // Actions
  loadShows: async () => { ... },
  saveShow: async (show) => { ... },
  deleteShow: async (showId) => { ... },
  setActiveShow: (show) => { ... },
  updateRunnerState: (patch) => { ... },
}
```

---

## 7. IPC 핸들러 추가 (`src/main/index.js` + `src/preload/index.js`)

```javascript
// 신규 IPC 핸들러
'file:load-shows'           // resources/shows/ 디렉토리의 모든 show 로드
'file:save-show'            // show 저장 (resources/shows/{show_id}.json)
'file:delete-show'          // show 삭제
```

기존 `file:load-scenes`, `file:save-scene` 등은 변경 없이 재사용.

---

## 8. 사이드바 네비게이션 확장 (`src/renderer/src/components/Sidebar.jsx`)

현재 5개 화면: `live`, `scenes`, `cues`, `fixtures`, `settings`

신규 추가:
- `show-editor` — Show 편집기 (아이콘: 🎵 또는 악보 아이콘)
- `show-runner` — 공연 실행기 (아이콘: ▶ Play 아이콘)

---

## 9. 구현 순서 (Phase별)

### Phase 1: 데이터 레이어 (기반 작업)
1. `resources/shows/` 디렉토리 생성
2. `src/main/index.js` — `file:load-shows`, `file:save-show`, `file:delete-show` 핸들러 추가
3. `src/preload/index.js` — 신규 IPC API 노출
4. `src/renderer/src/store.js` — shows 슬라이스 추가

**검증:** DevTools에서 `window.api.loadShows()` 호출 시 빈 배열 반환

### Phase 2: BpmEngine 구현
1. `src/renderer/src/engines/bpm-engine.js` 생성
2. `performance.now()` 기반 마디 타이머 구현
3. Segment → Song → Setlist 자동 전환 로직
4. Breakpoint 일시정지 + resume() 메서드
5. `src/renderer/src/App.jsx` — BpmEngine 인스턴스화 + store 연결

**검증:** 콘솔에서 engine.load(mockShow); engine.start() 호출 후 정해진 마디마다 콘솔 로그 확인

### Phase 3: ShowEditorScreen
1. `src/renderer/src/screens/ShowEditorScreen.jsx` 생성
2. Song 목록 + Setlist 편집 UI
3. Segment 편집 (Scene 선택 드롭다운, Bars 입력, Fade 입력)
4. Breakpoint 삽입/삭제
5. 사이드바에 `show-editor` 항목 추가

**검증:** Show 생성 → 저장 → 앱 재시작 후 데이터 유지 확인

### Phase 4: ShowRunnerScreen
1. `src/renderer/src/screens/ShowRunnerScreen.jsx` 생성
2. Setlist 진행 표시 + 현재 Segment 프로그레스바
3. GO 버튼 (Breakpoint 재개)
4. STOP / 이전 / 다음 컨트롤
5. BPM 변경 시 표시 업데이트
6. 사이드바에 `show-runner` 항목 추가

**검증:** Show 로드 → 시작 → 마디마다 Scene 자동 전환 확인, Breakpoint에서 일시정지 확인, GO 후 재개 확인

### Phase 5: Effect Engine BPM 연동 (선택적 고도화)
- 효과의 `speed` 파라미터를 "beats per cycle" 단위로 옵션 제공
- BpmEngine에서 현재 BPM을 EffectEngine으로 브로드캐스트
- Chase, sinePulse, colorWave 효과가 BPM에 lock됨

---

## 10. 엣지 케이스 및 처리 방안

| 케이스 | 처리 방안 |
|--------|-----------|
| Segment에 연결된 Scene이 삭제된 경우 | 해당 Segment는 "Scene 없음"으로 표시, Runner는 건너뛰고 다음 Segment 진행 |
| Setlist가 비어있을 때 Start | 버튼 비활성화 + 경고 메시지 |
| BPM = 0 또는 음수 | 저장 시 유효성 검사, 최소값 40 BPM |
| 공연 중 Show 편집 | ShowRunnerScreen에서 편집 버튼 비활성화 (Running 상태일 때) |
| 앱 재시작 중 RunnerState | RunnerState는 메모리 전용, 재시작 시 stopped 상태로 초기화 |
| Bars = 0 | 최소 1로 강제 |
| Blackout 중 자동 전환 | 전환은 일어나되 blackout 상태 유지 (기존 toggleBlackout 동작 그대로) |

---

## 11. 파일 변경 요약

| 파일 | 변경 유형 | 내용 |
|------|-----------|------|
| `src/main/index.js` | 수정 | `file:load-shows`, `file:save-show`, `file:delete-show` 핸들러 추가 |
| `src/preload/index.js` | 수정 | 신규 IPC API 노출 |
| `src/renderer/src/store.js` | 수정 | shows 슬라이스 + runnerState 슬라이스 추가 |
| `src/renderer/src/App.jsx` | 수정 | BpmEngine 인스턴스화, ShowEditorScreen/ShowRunnerScreen 라우팅 추가 |
| `src/renderer/src/components/Sidebar.jsx` | 수정 | show-editor, show-runner 메뉴 항목 추가 |
| `src/renderer/src/engines/bpm-engine.js` | **신규** | BPM 타이머 엔진 |
| `src/renderer/src/screens/ShowEditorScreen.jsx` | **신규** | Show 편집 화면 |
| `src/renderer/src/screens/ShowRunnerScreen.jsx` | **신규** | 공연 실행 화면 |
| `resources/shows/` | **신규** | Show JSON 파일 저장 디렉토리 |

**변경하지 않는 파일:** `effect-engine.js`, `fade-engine.js`, `serial-bridge.js`, `CueListScreen.jsx`, `SceneBrowserScreen.jsx`, `LiveScreen.jsx`, `SettingsScreen.jsx`, `fixtures.json`, `cue-list.json`

---

## 12. 검증 시나리오 (End-to-End)

1. **Show 생성 테스트**
   - ShowEditorScreen에서 Show 생성
   - Song 2개 추가 (BPM 120 / BPM 140)
   - 각 Song에 Segment 2~3개 추가, Scene 연결
   - Setlist: Song1 → Breakpoint(멘트) → Song2
   - 저장 후 앱 재시작 → Show 데이터 유지 확인

2. **자동 전환 테스트** (simulate mode)
   - ShowRunnerScreen에서 Show 선택 → Start
   - Song1의 Segment1이 지정된 마디 후 Segment2로 자동 전환되는지 확인
   - Segment 전환 시 fade_in_ms만큼 페이드 인 되는지 확인
   - Song1 끝 → Breakpoint(멘트) 상태로 자동 정지 확인

3. **Breakpoint 재개 테스트**
   - Breakpoint 상태에서 GO 버튼 클릭
   - Song2가 BPM 140으로 시작되는지 확인
   - Song2의 첫 Segment Scene이 정확히 호출되는지 확인

4. **수동 컨트롤 테스트**
   - 실행 중 "다음" 버튼 → 즉시 다음 Segment로 이동
   - 실행 중 "이전" 버튼 → 이전 Segment로 이동 및 타이머 리셋
   - STOP → running 상태 종료, Scene은 마지막 상태 유지

---

*작성일: 2026-05-11 | 브랜치: feature/bpm-sync*
