# Build-Up Club (빌드업 클럽)

3개 자매 프로젝트를 하나로 통합한 **전술 빌드업 축구 클럽 게임**.
한 경기 = 한 번의 결정적 빌드업 모먼트(전술 코어). 이겨서 선수를 강화하고 디비전을 올라 1부 우승까지(클럽 메타).

- 실행: 정적 서버로 `index.html` 서빙 (`python -m http.server 8080` → `http://localhost:8080`).
  ES 모듈이라 `file://` 직접 열기는 안 됨(정적 서버 필수).
- 콘솔 훅: `window.__game`(engine/dispatch/newAttempt), `window.__buc`(club 상태/enterHub/startMatch).

## 통합 출처 (3 → 1)
- **전술 코어 = soccer-pass-game (Beat the Block)**: 압박 유인→블록 이동→프리맨→마무리.
  `js/engine/*`(engine·press·space·superiority·shots·outcome), `js/ui/*`(renderer·hud), `js/data/*`(scenarios·formations). **원본 그대로 보존**.
- **클럽 메타 = idle-football-club**: 디비전·경제·업그레이드·프레스티지·오프라인·다국어.
  `js/career/club.js`로 이식(state.js 기반).
- **실시간 감각/배당 = xxx (피파 2D)**: 매치 전 예상 승무패(odds) 표시, juice.

## 통합의 핵심 — `js/career/mods.js` (글루)
엔진 내부는 **한 줄도 수정하지 않음**. 비결: 선수 `traits`(pass/shot/keeping)가 dispatch 시점에
실시간으로 읽히므로(`engine.js`·`shots.js`), `createEngine` 직후 'us' 선수 traits를 클럽 공격
레벨만큼 부스트하면 전술 플레이 전체가 그만큼 쉬워진다.
- 공격 레벨(fw/mf) → `applyClubBoost`로 pass/shot 트레잇 ↑ → 패스가 덜 끊기고 슛이 더 들어감.
- 상대 OVR(디비전 램프) → `intensityOverride`(압박 mid/high/vhigh).
- 수비 레벨(gk/df) → 경기 후 `resolveScoreline`의 실점 시뮬로 작동.
- 그래서 업그레이드가 숫자가 아니라 **체감**으로 돌아온다. (불변식: 이 글루를 깨면 메타↔코어 연결이 사라짐)

## 커리어 플로우 (`js/main.js`)
타이틀 → **클럽 허브**(`js/career/hub.js`) → "다음 경기"(매치데이 시나리오+상대 셋업)
→ 전술 브리핑 → 킥오프 → 전술 매치 → 종료 시 `settleCareerMatch()`(스코어라인 시뮬→정산)
→ **결과 카드** → 허브 복귀. `careerActive` 플래그로 전술 단판 모드와 분기.

## 파일 맵
```
js/career/club.js    — 상태·경제·디비전·승격·프레스티지·저장 (idle 이식)
js/career/mods.js    — 통합 글루: 업그레이드→traits 부스트 + 실점 시뮬 + odds
js/career/season.js  — 매치데이별 시나리오 로테이션 + 상대팀명 생성
js/career/hub.js     — 클럽 허브 UI(스쿼드 강화·승격게이지·배당)
js/career/i18n.js    — ko/en (커리어 셸; 전술 보드 라벨은 한국어 고정)
js/main.js           — 부트스트랩 + 커리어↔매치↔결과 플로우 (전술 코어 위 래핑)
```

## 밸런스 회귀
`node scripts/career-sim.mjs` — 글루 단조성(레벨↑→부스트↑), 실점 모델(수비↑→실점↓),
1부 우승+프레스티지 완주, NaN/Infinity 0건 게이트. 경제/글루 수치 변경 시 필수.
(주의: 이 워크스페이스의 Linux 마운트는 Edit 누적분 동기화가 지연될 수 있음 — 브라우저 실행이 정본.)
