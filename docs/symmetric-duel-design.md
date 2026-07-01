# 대칭 AI 대결 토대 설계

## 목적

지금 빌드업 클럽은 "우리가 공을 가지고 상대 압박을 깨는" 한쪽 시점의 게임이다. 압박 탈취 모드가 잠깐 역할을 뒤집지만, 상대는 여전히 스스로 빌드업하지 않는 확률 모델이다.

이 문서는 **AI가 양쪽을 각각 조작해 압박과 빌드업으로 맞붙고, 그 자기대국(self-play)에서 문제·개선점을 자동으로 찾을 수 있는 토대**를 설계한다.

핵심 목표 세 가지:

- 상대를 확률 모델이 아니라 **진짜 점유 에이전트**로 만든다.
- 소유권이 양방향으로 도는 **대칭 루프**를 만든다.
- `evaluateBoard`를 **정책(policy)으로 떼어내** 사람이든 AI든 어느 쪽이든 조작할 수 있게 한다.

## 한 줄 요약

정책 인터페이스를 도입하고, 소유권을 1급 상태로 올리고, 비점유 측은 좌표 미러로 같은 빌드업 로직을 재사용하게 한다. 그러면 **하나의 엔진으로 사람 플레이·AI 단측·AI 양측 자기대국이 전부** 돌아간다.

## 현재 구조 — 정확한 비대칭 진단

`engine.js` 기준 현재 사실:

- 선수는 `side === 'us'` 또는 `side === 'opp'`. `ours()` / `opps()` 로 구분.
- 소유는 `state.holderId` 하나로만 추적된다.
- 빌드업 로직이 **"us가 +x 방향으로 전진한다"는 가정에 박혀 있다.** 페이즈 전환(BUILDUP→PROGRESSION→FINAL_THIRD→SHOT)이 `holder.x > PHASE_LINES.*` 로 결정된다.
- 상대(opp)는 점유 주체가 아니라 **압박/블록 모델**이다: `pressInfo`, `pressureExpression`, 적응(`adaptRead`), `defensivePressProb`, 동적 상황(`pressure_surge` / `flank_lock` / `counter_risk`).
- 압박 탈취 모드는 역할을 잠깐 뒤집지만 결과는 `resolveDefensivePress` 의 **확률로 해소**되고, 상대가 스스로 빌드업하지는 않는다.
- `evaluateBoard(engine)` 는 공 가진 쪽의 보드 리드(최선/도박/덫)를 반환한다 — **이미 사실상의 공격 정책**이다.

결론: **"구체적인 우리 + 추상적인 상대"** 구조다. 대칭 대결의 두 전제 — (1) 상대도 점유해서 빌드업한다, (2) 조작 주체가 정책으로 분리돼 있다 — 가 빠져 있다.

## 목표 모델

### 1. 소유권을 1급 상태로

- `state.possession = 'us' | 'opp'` (또는 `attackingSide`)를 명시한다. `holderId` 는 그 안에서의 현재 볼 소유자.
- 소유 전환 이벤트를 명시적으로 만든다: **턴오버**(패스 실패·차단), **리게인**(압박 성공), **리셋**(키퍼로 복귀), **재시작**(골·아웃 이후).

### 2. 정책(Agent) 인터페이스 — 핵심 enabler

- 단일 시그니처: `policy(view) => action`. `view` 는 그 턴, 그 측 관점의 상태(가능한 액션·보드 리드 포함).
- 엔진은 양측 정책 슬롯을 받는다: `{ us: Policy, opp: Policy }`.
  - **사람** = UI 입력을 action으로 바꾸는 특수 정책.
  - **공격 AI** = `evaluateBoard` 의 best를 고르는 정책.
  - **압박 AI** = 비점유 측에서 압박/차단/후퇴를 고르는 정책.
- 이 분리 하나만으로 **"AI 단측 자동 플레이"가 즉시 가능**해진다 — 엔진 내부를 대칭화하지 않아도 된다. (그래서 Phase 0이 저위험·고가치다.)

#### Policy 계약

Phase 0에서는 정책을 함수 하나로 고정한다.

```js
policy(view) => PolicyAction
```

정책은 엔진 상태를 직접 수정하지 않는다. 정책은 “이번 턴에 무엇을 시도할지”만 반환하고, 실제 상태 변경은 기존 엔진 액션/상황 선택 경로가 처리한다.

#### PolicyView

`PolicyView` 는 정책이 읽을 수 있는 관측값이다.

필수 필드:

- `side`: 정책을 실행하는 측. `us | opp`.
- `possession`: 현재 공 소유 측. `us | opp`.
- `phase`: 현재 국면. 예: `BUILDUP`, `PROGRESSION`, `FINAL_THIRD`, `PRESSING`, `SHOT`.
- `holderId`: 현재 볼 소유자.
- `turn`: 현재 턴.
- `recentActions`: 최근 액션 목록. 정책이 같은 선택을 반복해 단조 루프에 빠지는지 판단하는 데 쓴다.
- `legalActions`: 지금 선택 가능한 행동 목록.
- `boardRead`: 점유 측 공격 평가. 기존 `evaluateBoard` 결과를 정책용으로 정리한 값.
- `oppBuildRead`: 상대가 점유하거나 점유한다고 가정했을 때의 읽기 전용 빌드업 평가. Phase 1에서는 `oppBuildDryRun` 결과를 그대로 노출하고, 실행은 하지 않는다.
- `pressRead`: 비점유 측 압박 평가. 압박 가능 선수, 탈취 확률, 실패 비용을 요약한 값.
- `situation`: `matchDecision` 이 있으면 그 선택지 목록.

Phase 0에서는 모든 정보를 완벽히 일반화하지 않는다. 기존 엔진에서 이미 안전하게 읽을 수 있는 값만 넣고, 좌표 미러가 필요한 값은 Phase 1로 미룬다.

#### PolicyAction

정책이 반환하는 액션은 다음 형태로 고정한다.

```js
{
  kind: 'engine_action' | 'situation_choice' | 'noop',
  actionId?: 'to_feet' | 'pass_space' | 'carry' | 'hold' | 'shoot' | 'press_mode',
  targetId?: string,
  point?: { x: number, y: number },
  choiceId?: string,
  confidence?: number,
  reason?: string
}
```

의미:

- `engine_action`: 기존 `engine.dispatch(actionId, targetId, point)` 로 실행할 수 있는 행동.
- `situation_choice`: 기존 `engine.chooseSituationOption(choiceId)` 로 실행할 수 있는 상황 선택.
- `noop`: 이번 턴에 실행 가능한 정책 판단이 없을 때의 명시적 무행동. 하니스가 무한 루프를 감지하는 데 쓴다.
- `confidence`: 정책이 자기 선택을 얼마나 강하게 보는지. 게임 규칙에는 직접 쓰지 않고 리포트/디버그에 사용한다.
- `reason`: 하니스 리포트에 남길 사람이 읽는 이유. 예: `best safe lane`, `press has positive EV`, `drop avoids failed trap`.

금지:

- 정책이 `engine.state` 를 직접 수정하면 안 된다.
- 정책이 랜덤 결과를 직접 확정하면 안 된다. 확률 판정은 엔진만 한다.
- 정책이 DOM/UI를 읽으면 안 된다. 사람 입력도 “사람 정책” 어댑터를 통해 `PolicyAction` 으로 변환한다.

#### 기본 정책 3종

Phase 0에서 필요한 정책은 세 개다.

1. HumanPolicy
   - UI 입력을 `PolicyAction` 으로 바꾼다.
   - 기존 사람 플레이 경로의 의미를 바꾸지 않는다.

2. AttackPolicy
   - 점유 측에서 `boardRead.best` 를 고른다.
   - 슛 후보가 충분히 좋으면 `shoot`.
   - 패스 후보가 좋으면 `to_feet` 또는 `pass_space`.
   - 좋은 후보가 없으면 `hold`.

3. PressPolicy
   - 비점유 측에서 `pressRead` 를 본다.
   - `oppBuildRead` 의 `best/gamble/trap` 을 함께 읽어 상대의 예상 탈출 레인을 판단한다.
   - 기대값이 높으면 `press_mode` 후 `dp_press`.
   - 직접 압박보다 길목 차단이 나으면 `dp_cut`.
   - 실패 비용이 너무 크면 `dp_drop`.

#### Self-play 하니스 실행 단위

`selfplay-probe` 는 “한 경기”를 다음 반복으로 실행한다.

1. 현재 `PolicyView` 를 만든다.
2. 현재 행동권을 가진 측의 정책을 호출한다.
3. `PolicyAction` 을 엔진 API로 실행한다.
4. 결과 로그, 액션 빈도, 압박 성공/실패, outcome 을 기록한다.
   - Phase 1 이후에는 `defensive_press` 정책 판단마다 압박 AI 의견과 탈압박 AI 의견을 함께 집계한다. 압박 쪽은 선택지·성공 확률·차단할 레인을 말하고, 탈압박 쪽은 `oppBuildRead.best/gamble/trap` 기준으로 가장 좋은 출구를 말한다.
5. 종료 조건에 닿으면 경기 리포트를 반환한다.

Phase 0에서는 행동권을 완전한 소유권 시스템으로 만들지 않는다. 기존 사람 플레이와 같은 진행을 유지하되, 사람 입력 대신 정책이 기존 엔진 액션을 고르는 것부터 시작한다.

### 3. 관점 일반화 — 좌표 미러

- 빌드업 로직을 측마다 다시 쓰지 않는다. 비점유 측이 점유로 바뀌면, 좌표를 `x → PITCH_W - x` 로 **미러**하고 side 라벨을 스왑해, 엔진에는 "항상 +x로 전진하는 us"처럼 보여준다. 같은 로직을 실행한 뒤 렌더·결과용으로 좌표를 되돌린다.
- 체스 엔진의 "side-to-move + 보드 플립"과 같은 기법. **엔진 코드 중복을 최소화**하면서 양측이 동일한 빌드업 규칙을 공유한다.

## 단계적 로드맵 (빅뱅 금지)

순서가 중요하다. 각 단계는 그 자체로 가치가 있고, 사람 플레이 경로를 깨지 않는다.

### Phase 0 — 정책 인터페이스 + 현재(비대칭) 모델 자기대국

- 위험 낮음, 가치 큼. 엔진 내부 대칭화 없이 시작.
- `evaluateBoard` 를 공격 정책으로 래핑 + 간단한 압박 정책 추가.
- `scripts/selfplay-probe.mjs` 로 수백 경기를 헤드리스로 돌려 **첫 밸런스 리포트** 산출.
- 사람 플레이 경로는 그대로 유지(정책 슬롯에 "사람"을 넣은 것과 동치).

### Phase 1 — 상대 빌드업을 좌표 미러로 추출

- 비점유 측이 점유하면 좌표 미러로 **같은 빌드업 로직**을 실행한다.
- 이 단계까지는 마무리/실점이 기존 추상 해소를 써도 된다(점진 이행).
- 미러 대상은 현재 좌표만이 아니다. `x/y` 뿐 아니라 `homeX/homeY`, 애니메이션 좌표(`rx/ry`, `fx/fy`, `tx/ty`), `rewardWindow`, 전환 손실 지점(`transition.loss`)도 함께 회전해야 한다. 이 필드가 빠지면 오프볼 구조와 압박 창이 원래 좌표로 당겨져 비대칭이 생긴다.
- 읽기 전용 dry-run은 두 경우를 구분한다. 실제 `holderId` 가 `opp` 선수면 그 선수를 기준으로 읽고(`holderAssumption: 'actual'`), 아직 우리 점유 상태에서 "상대가 잡는다면"을 가정할 때만 최후방 빌더를 시작점으로 둔다(`holderAssumption: 'deepest'`).

### Phase 2a — 소유권 전환 FSM

- `turnover`, `press_regain`, `reset`, `restart` 이벤트가 다음 `possession`, `holderId`, `phase`, `mirror` 플래그를 순수 함수로 계산한다.
- 이 단계는 `engine.state` 를 직접 변경하지 않는다. Phase 0/1 계약을 깨지 않으면서 "누가 어디서 빌드업을 다시 시작해야 하는가"만 고정한다.

### Phase 2b — 엔진 소유권 전환 루프

- Phase 2a의 FSM 결과를 `engine.js`에 얇게 적용한다.
- 첫 연결은 기본 비활성 옵션(`possessionTurnoverLoop`) 뒤에 둔다. 카운터프레스 전환 창에서 후퇴/실패로 기존에는 `finishAttempt` 되던 한 지점만, 옵션이 켜졌을 때 `applyPossessionEvent(..., 'turnover')` 로 상대 빌드업 상태를 만든다.
- 다음 연결도 같은 옵션 뒤에 둔다. `advanceOpponentBuildUp()` 은 기본값에서는 `oppBuildDryRun.best` 를 실제 상대 holder 전환으로 한 번 적용하고, 명시적 성향(`safe | balanced | aggressive | direct`)이 들어오면 `best/gamble/trap` 후보 중 성향별 가중치와 risk cap으로 고른다. 아직 일반 `dispatch` 를 뒤집지 않으며, 인터셉트/실패 판정도 하지 않는다.
- 성향은 `createEngine(..., { possessionTurnoverLoop: true, opponentBuildDisposition: 'aggressive' })` 또는 `advanceOpponentBuildUp({ disposition })` 으로 주입한다. 미지정이면 기존 안전 경로처럼 결정적 `best`만 사용한다.
- 반복 호출은 전진성 있는 선택만 성공 처리한다. 상대 공격 방향으로 1m 이상 전진하지 못하면 `stalled` 또는 안전 중단으로 반환해 ST-LW 같은 무의미한 왕복 루프를 막는다.
- 옵션 경로의 `advanceOpponentBuildUp()` 은 `stalled` 를 우리 압박 리게인(`press_regain`)으로 해석한다. 즉 상대 빌드업이 전진 출구를 잃으면 우리 소유로 되돌린다.
- `scripts/possession-loop-probe.mjs` 는 옵션 경로에서 `us 턴오버 → opp 빌드업 반복 → stalled → us 리게인` 왕복을 대량 검증한다. 현재는 안전성 하니스이며, 상대 빌드업 다양성은 `chooseOppBuild` 정책과 별도 정책 테스트로 검증한다.
- `scripts/possession-loop-probe.mjs 80 aggressive` 처럼 세 번째 인자로 성향을 주면 실제 왕복 루프 안에서 여러 상대 빌드업 루트가 나오는지 함께 검증한다.
- `scripts/possession-selfplay-probe.mjs 120 aggressive` 는 같은 왕복 루프를 자기대국 관측면으로 돌린다. 각 상대 점유 상태마다 상태를 바꾸지 않는 advisory view를 만들어 압박 AI 의견(`dp_press | dp_cut | dp_drop`)과 탈압박 AI 의견(`best/gamble/trap` 출구)을 함께 기록한다.
- 턴오버·압박 성공·리셋이 **반대 측 빌드업 시작**으로 이어진다.
- 양방향 소유가 실제로 한 경기 안에서 돈다.
- 이 단계부터는 로컬 런타임 검증이 필수다. 사람 플레이 경로, 압박 모드, self-play 하니스가 모두 같은 결과를 유지해야 한다.

### Phase 3 — 완전 대칭 자기대국 + 하니스

- 압박 AI vs 빌드업 AI가 동등하게 맞붙는다.
- 하니스가 양측 정책을 갈아 끼우며 대량 경기를 돌려 리포트한다.

## 자기대국 하니스와 측정 지표

무엇을 찾으려는가(= 자동으로 드러낼 문제):

- 특정 액션·전략이 지배적인지(단조로움).
- 압박이 **항상 +EV**인지(그러면 늘 강한 압박만 누름 — 밸런스 깨짐).
- 승률·득점 분포·무승부율.
- 무한 루프나 비정상(degenerate) 진행.

핵심 지표:

- 점유 승리율, 점유당 기대 득점.
- 압박 성공률 대비 실패 비용.
- 액션 엔트로피(선택 다양성) — 낮으면 단조.
- 적응 효과 — 같은 액션 반복 시 위험이 실제로 오르는지.
- **대칭 미러전 50:50** 여부(아래 불변식).

## 밸런스 불변식 (검증의 핵)

- **같은 정책을 양측에 두면 결과는 약 50:50이어야 한다.** 한쪽으로 치우치면 그것은 전략이 아니라 구조 버그(좌표 미러·페이즈·소유 전환의 비대칭)다. `selfplay-probe` 가 이 불변식을 고정한다.
- 압박 세 선택지(강하게 압박·패스길 차단·블록 후퇴)가 모두 의미 있게 살아 있어야 한다 — 어느 하나가 항상 우월하면 안 된다.

## 리스크·비용

- **관점 일반화(Phase 1~)는 엔진 전체에 닿는다** — 렌더러, `evaluator.js`, 압박, 동적 상황까지. 고위험.
- 완화책:
  - Phase 0(정책 분리)은 엔진 내부를 건드리지 않는다 → 안전한 출발점.
  - 미러는 좌표 변환 "한 겹"으로 로직을 재사용 → 중복·버그 표면 최소화.
  - 사람 플레이 경로를 **매 단계 회귀 테스트**로 지킨다.
- **환경 제약:** 샌드박스 마운트가 `engine.js` 를 잘라 자동 플레이를 사이드에서 못 돌린다. 하니스 코드는 작성하되 **실행·측정은 로컬**에서 한다.

## MVP 범위 (Phase 0)

포함:

- `Policy` 인터페이스(`policy(view) => action`).
- `PolicyView` / `PolicyAction` 계약.
- 엔진에 `{ us, opp }` 정책 슬롯(기본값 = 사람/현행 동작).
- `evaluateBoard` 공격 정책 래퍼 + 간단 압박 정책.
- `scripts/selfplay-probe.mjs` — N경기 자동 플레이 + 밸런스 리포트.
- 대칭 점검용 단위 테스트(같은 정책 양측 → 편향 없음 확인).

제외(Phase 1 이후로):

- 좌표 미러, 상대 빌드업 추출.
- 소유권 양방향 전환 루프.
- 완전 대칭 마무리/실점.

## 완료 기준 (Phase 0)

- 정책만으로 사람 입력 없이 한 경기를 완주한다.
- `selfplay-probe` 가 N경기를 돌려 밸런스 리포트(승률·득점분포·액션빈도·압박 성공/비용)를 출력한다.
- 같은 정책을 양측에 두면 결과가 ~50:50(허용 오차 내)으로 나온다.
- 사람 플레이 경로에 회귀가 없다(기존 브라우저 스모크 통과).

## 이후 확장

1. 학습형 정책 — 자기대국 통계로 정책 가중치를 조정(휴리스틱 튜닝 루프).
2. 상대 성향 프리셋 — 하이프레스/미드블록/로우블록 정책을 갈아 끼워 매치업 다양성.
3. 리그 규모 자기대국 — 디비전별 전력 차를 반영한 대량 시뮬로 커리어 밸런스 검증.
4. 리플레이·관전 — 자기대국 한 경기를 보드에 재생해 사람이 눈으로 문제를 확인.
