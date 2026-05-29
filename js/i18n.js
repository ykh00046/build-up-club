// ─── Build-Up Lab i18n (EN / KO / JA) ───────────────────────
// English is the source/default; KO & JA fall back to EN per-key.
// Football position codes (GK/CB/DM/ST…), grade letters (S/A/B) and
// scenario codes (DRILL 01…) stay universal and are NOT translated.

const I18N_LANGS = ['en', 'ko', 'ja'];
const I18N_DEFAULT = 'en';
const I18N_STORAGE_KEY = 'buildup-lab:lang';

const I18N = {
  en: {
    'lang.label': 'EN',
    'header.subtitle': 'WORLD STAGE CHALLENGE',
    'header.board': 'MATCHDAY TACTICAL BOARD',
    'audio.on': 'AUDIO: ON',
    'audio.off': 'AUDIO: OFF',

    'panel.scenarios': 'MATCH MOMENTS',
    'featured.kicker': 'FEATURED MATCH MOMENT',
    'featured.play': 'PLAY FEATURED MOMENT',
    'tab.0': 'TUTS', 'tab.1': 'PATS', 'tab.2': 'SHAPES', 'tab.3': 'ADV', 'tab.4': 'GED',
    'card.subtitle': 'world-stage build-up',

    'action.pass.title': 'PASS',        'action.pass.sub': 'direct lane',
    'action.bounce.title': 'BOUNCE',    'action.bounce.sub': 'one-two',
    'action.thirdMan.title': '3RD MAN', 'action.thirdMan.sub': 'blind-side',
    'action.switchPlay.title': 'SWITCH','action.switchPlay.sub': 'far-side',
    'action.dropPivot.title': 'DROP DM','action.dropPivot.sub': 'deep support',

    'coach.note': 'MATCH NOTE: Solve the pressure moment in limited actions.',

    'panel.feed': 'LIVE ANALYTICAL FEED',
    'stat.ourShape': 'OUR SHAPE:',
    'stat.pressShape': 'PRESS SHAPE:',
    'stat.actionLimit': 'ACTION LIMIT:',
    'stat.linesBroken': 'LINES BROKEN:',
    'stat.activeZone': 'ACTIVE ZONE:',
    'panel.ticker': 'LIVE ACTION TICKER',
    'panel.guides': 'TACTICAL GUIDES',
    'guide.radius': 'PRESSING RADIUS',
    'guide.shadow': 'COVER SHADOWS',
    'guide.channels': 'HALFSPACE CHANNELS',
    'guide.engagement': 'ENGAGEMENT LINES',
    'btn.hint': 'HINT 💡',
    'btn.editor': 'DRILL EDITOR',
    'btn.playMode': 'PLAY MODE',
    'role.gk': 'SWEEP GK', 'role.cb': 'B-PLAYING CB', 'role.invFb': 'INVERTED FB', 'role.wingback': 'WINGBACK',
    'role.pivot': 'DEEP PIVOT', 'role.mezzala': 'MEZZALA', 'role.b2b': 'BOX-TO-BOX', 'role.advPl': 'ADVANCED PL',
    'role.cm': 'CENTRE MID', 'role.falseNine': 'FALSE NINE',
    'role.presser': '1ST PRESSER', 'role.chase': 'TRAP WIDE', 'role.patrol': 'FAR-SIDE LOCK', 'role.static': 'SCREEN PIVOT',

    'val.ourShape': 'BUILD-UP UNIT',
    'val.pressShape': 'PRESSING BLOCK',
    'val.concept': 'BUILD-UP DRILL',
    'val.freeSpace': 'FREE SPACE',

    'intro.formation': 'OUR FORMATION',
    'intro.pressShape': 'PRESS SHAPE',
    'intro.concept': 'INTENDED CONCEPT',
    'intro.situation': 'TACTICAL SITUATION',
    'intro.start': 'EXECUTE DRILL',

    'lose.badge': 'FAIL DETECTED',
    'lose.title': 'DRILL INTERRUPTED!',
    'lose.adjust': 'ADJUST POSITION [Z]',
    'lose.reset': 'RESET DRILL [R]',

    'result.badge': 'MOMENT SOLVED',
    'result.title': 'PRESS BEATEN!',
    'result.grade': 'TACTICAL GRADE',
    'result.actions': 'ACTIONS USED:',
    'result.lines': 'LINES BROKEN:',
    'result.outlet': 'ESCAPE CHANNEL:',
    'result.concept': 'CONCEPT:',
    'result.retry': 'RETRY SETUP',
    'result.next': 'NEXT SETUP',
    'result.share': 'SHARE CHALLENGE RESULT',
    'result.copied': 'CHALLENGE RESULT COPIED!',

    'channel.LW': 'LEFT WING',
    'channel.LHS': 'LEFT HALF-SPACE',
    'channel.C': 'CENTRE',
    'channel.RHS': 'RIGHT HALF-SPACE',
    'channel.RW': 'RIGHT WING',

    'canvas.escaped': 'MATCH MOMENT SOLVED!',
    'canvas.free': 'FREE',

    'lane.safe': 'safe lane',
    'lane.lineBreaking': 'broke {n} line',
    'lane.risky': 'risky: {reason}',
    'lane.baited': 'baited trap',
    'lane.blocked': 'blocked: {reason}',
    'reason.pressureRadius': 'pressure',
    'reason.coverShadow': 'cover shadow',
    'reason.outOfRange': 'out of range',
    'reason.receiverPressure': 'marked',
    'reason.trapZone': 'trap',
    'reason.lineBreak': 'line break',
    'reason.marked': 'marking',
    'reason.noOutlet': 'no outlet',
    'reason.near': 'pressure',
    'reason.backPass': 'back pass',
    'reason.goalsidePressure': 'goalside pressure',

    'fail.limit': 'Exceeded allowable actions',
    'fail.intercept': 'Pass route intercepted by opponent block',
    'fail.trappedShift': 'Receiver trapped after the press shift',
    'fail.trappedBy': 'Receiver trapped by {reason}',
    'fail.noOutlet': 'No safe outlet after the press shift',

    'log.trap': 'TRAP {zone} — press collapses',
    'log.win': 'WIN — PRESS ESCAPED → {zone}',
  },

  ko: {
    'lang.label': '한',
    'header.subtitle': '매치데이 분석',
    'header.board': '전술 보드 V2.0',
    'audio.on': '사운드: 켜짐',
    'audio.off': '사운드: 꺼짐',

    'panel.scenarios': '시나리오 목록',
    'featured.kicker': '추천 매치 모먼트',
    'featured.play': '추천 장면 플레이',
    'tab.0': '기초', 'tab.1': '패턴', 'tab.2': '형태', 'tab.3': '심화', 'tab.4': '전술',
    'card.subtitle': '빌드업 대 압박',

    'action.pass.title': '패스',     'action.pass.sub': '직선 패스길',
    'action.bounce.title': '바운스', 'action.bounce.sub': '원투',
    'action.thirdMan.title': '서드맨','action.thirdMan.sub': '블라인드 사이드',
    'action.switchPlay.title': '전환','action.switchPlay.sub': '반대편',
    'action.dropPivot.title': '드롭 DM','action.dropPivot.sub': '깊은 지원',

    'coach.note': '코칭 노트: 직접 패스를 하거나 전술 액션을 선택하세요.',

    'panel.feed': '실시간 분석 피드',
    'stat.ourShape': '우리 형태:',
    'stat.pressShape': '압박 형태:',
    'stat.actionLimit': '액션 제한:',
    'stat.linesBroken': '돌파한 라인:',
    'stat.activeZone': '타깃 존:',
    'panel.ticker': '실시간 액션 로그',
    'panel.guides': '전술 가이드',
    'guide.radius': '압박 범위',
    'guide.shadow': '커버 섀도',
    'guide.channels': '하프스페이스 채널',
    'guide.engagement': '교전 라인',
    'btn.hint': '힌트 💡',
    'btn.editor': '드릴 에디터',
    'btn.playMode': '플레이 모드',
    'role.gk': '스위퍼 GK', 'role.cb': '빌드업 CB', 'role.invFb': '인버티드 FB', 'role.wingback': '윙백',
    'role.pivot': '딥 피벗', 'role.mezzala': '메짤라', 'role.b2b': '박투박', 'role.advPl': '공격형 MF',
    'role.cm': '중앙 MF', 'role.falseNine': '폴스 나인',
    'role.presser': '1선 압박', 'role.chase': '측면 유도', 'role.patrol': '약측 봉쇄', 'role.static': '피벗 차단',

    'val.ourShape': '빌드업 유닛',
    'val.pressShape': '압박 블록',
    'val.concept': '빌드업 드릴',
    'val.freeSpace': '빈 공간',

    'intro.formation': '우리 포메이션',
    'intro.pressShape': '압박 형태',
    'intro.concept': '의도된 컨셉',
    'intro.situation': '전술 상황',
    'intro.start': '드릴 실행',

    'lose.badge': '실패 감지',
    'lose.title': '드릴 중단!',
    'lose.adjust': '위치 조정 [Z]',
    'lose.reset': '드릴 초기화 [R]',

    'result.badge': '드릴 완료',
    'result.title': '압박 돌파!',
    'result.grade': '전술 등급',
    'result.actions': '사용 액션:',
    'result.lines': '돌파한 라인:',
    'result.outlet': '탈출 채널:',
    'result.concept': '컨셉:',
    'result.retry': '다시 시도',
    'result.next': '다음 세트',
    'result.share': '결과 요약 공유',
    'result.copied': '요약 복사됨!',

    'channel.LW': '좌측 측면',
    'channel.LHS': '좌측 하프스페이스',
    'channel.C': '중앙',
    'channel.RHS': '우측 하프스페이스',
    'channel.RW': '우측 측면',

    'canvas.escaped': '압박 돌파!',
    'canvas.free': '프리',

    'lane.safe': '안전한 길',
    'lane.lineBreaking': '{n}라인 돌파',
    'lane.risky': '위험: {reason}',
    'lane.baited': '유인 트랩',
    'lane.blocked': '막힘: {reason}',
    'reason.pressureRadius': '압박 범위',
    'reason.coverShadow': '커버 섀도',
    'reason.outOfRange': '거리 초과',
    'reason.receiverPressure': '마크됨',
    'reason.trapZone': '트랩',
    'reason.lineBreak': '라인 돌파',
    'reason.marked': '마킹',
    'reason.noOutlet': '출구 없음',
    'reason.near': '압박',
    'reason.backPass': '백패스',
    'reason.goalsidePressure': '골 방향 압박',

    'fail.limit': '허용 액션 수 초과',
    'fail.intercept': '패스 경로가 상대 블록에 차단됨',
    'fail.trappedShift': '압박 이동 후 리시버가 고립됨',
    'fail.trappedBy': '리시버 고립: {reason}',
    'fail.noOutlet': '압박 이동 후 안전한 출구 없음',

    'log.trap': '트랩 {zone} — 압박 붕괴',
    'log.win': '성공 — 압박 돌파 → {zone}',
  },

  ja: {
    'lang.label': '日',
    'header.subtitle': 'マッチデイ分析',
    'header.board': '戦術ボード V2.0',
    'audio.on': 'サウンド: ON',
    'audio.off': 'サウンド: OFF',

    'panel.scenarios': 'シナリオ一覧',
    'featured.kicker': 'FEATURED MATCH MOMENT',
    'featured.play': 'PLAY FEATURED MOMENT',
    'tab.0': '基礎', 'tab.1': '型', 'tab.2': '形', 'tab.3': '応用', 'tab.4': '戦術',
    'card.subtitle': 'ビルドアップ対プレス',

    'action.pass.title': 'パス',     'action.pass.sub': '直線レーン',
    'action.bounce.title': 'ワンツー','action.bounce.sub': 'ワンツー',
    'action.thirdMan.title': '3人目', 'action.thirdMan.sub': 'ブラインドサイド',
    'action.switchPlay.title': '展開','action.switchPlay.sub': '逆サイド',
    'action.dropPivot.title': 'ドロップDM','action.dropPivot.sub': '深いサポート',

    'coach.note': 'コーチングノート: 直接パスか戦術アクションを選択。',

    'panel.feed': 'ライブ分析フィード',
    'stat.ourShape': '自陣形:',
    'stat.pressShape': 'プレス形:',
    'stat.actionLimit': 'アクション制限:',
    'stat.linesBroken': '突破ライン:',
    'stat.activeZone': '対象ゾーン:',
    'panel.ticker': 'ライブアクションログ',
    'panel.guides': '戦術ガイド',
    'guide.radius': 'プレス範囲',
    'guide.shadow': 'カバーシャドウ',
    'guide.channels': 'ハーフスペース',
    'guide.engagement': '対応ライン',
    'btn.hint': 'ヒント 💡',
    'btn.editor': 'ドリルエディタ',
    'btn.playMode': 'プレイモード',
    'role.gk': 'スイーパーGK', 'role.cb': 'ビルドアップCB', 'role.invFb': '偽SB', 'role.wingback': 'ウイングバック',
    'role.pivot': 'アンカー', 'role.mezzala': 'メッザーラ', 'role.b2b': 'B2B', 'role.advPl': 'トップ下',
    'role.cm': 'セントラルMF', 'role.falseNine': '偽9番',
    'role.presser': '1stプレス', 'role.chase': 'サイド誘導', 'role.patrol': '逆サイド封鎖', 'role.static': 'ピボット遮断',

    'val.ourShape': '自フォーメーション',
    'val.pressShape': 'プレス形',
    'val.concept': '狙いの概念',
    'val.situation': '戦術状況',
    'val.start': 'ドリル開始',
    'val.escaped': 'プレス突破!',
    'val.free': 'フリー',

    'lane.safe': '安全なレーン',
    'lane.lineBreaking': '{n}ライン突破',
    'lane.risky': '危険: {reason}',
    'lane.baited': 'おとり罠',
    'lane.blocked': '遮断: {reason}',
    'reason.pressureRadius': 'プレス範囲',
    'reason.coverShadow': 'カバーシャドウ',
    'reason.outOfRange': '距離超過',
    'reason.receiverPressure': 'マーク',
    'reason.trapZone': '罠',
    'reason.lineBreak': 'ライン突破',
    'reason.marked': 'マーク',
    'reason.noOutlet': '出口なし',
    'reason.near': 'プレス',
    'reason.backPass': 'バックパス',
    'reason.goalsidePressure': 'ゴール側のプレス',

    'fail.limit': '許容アクション数を超過',
    'fail.intercept': 'パス経路が相手ブロックに遮断された',
    'fail.trappedShift': 'プレス移動後にレシーバーが孤立',
    'fail.trappedBy': 'レシーバー孤立: {reason}',
    'fail.noOutlet': 'プレス移動後に安全な出口なし',

    'log.trap': '罠 {zone} — プレス崩壊',
    'log.win': '成功 — プレス突破 → {zone}',
  },
};

// Per-level translations. English comes from window.LEVELS (source of truth).
const LEVEL_TR = {
  ko: {
    1:  { name: '프리맨을 찾아라', intro: '피벗 존의 마크되지 않은 동료에게 패스!', zone: '피벗 존' },
    2:  { name: '압박을 피하라', intro: '수비수의 압박 범위를 돌아 나가라!', zone: '측면 지역' },
    3:  { name: '커버 섀도 진입', intro: '패스 길을 막는 주황색 커버 섀도를 조심하라!', zone: '하프스페이스' },
    4:  { name: '움직이는 압박', intro: '순찰하는 미드필더가 비켜날 때를 노려라!', zone: '포켓 지역' },
    5:  { name: '미드블록 장벽', intro: '2인 수비 라인을 뚫을 길을 찾아라!', zone: '전진 피벗' },
    6:  { name: '바운스 패스 입문', intro: '[바운스]로 빠른 원투를 통해 압박을 우회하라!', zone: '약측 측면' },
    7:  { name: '서드맨 콤비네이션', intro: '[서드맨]으로 연결해 블라인드 사이드 침투를 발동하라!', zone: '라인 사이' },
    8:  { name: '사이드 전환!', intro: '[전환] 액션으로 약측 윙어를 활용하라!', zone: '고립 존' },
    9:  { name: '피벗 하강 지원', intro: '[드롭 DM]으로 미드필더를 내려 패스 각을 만들어라!', zone: '빈 공간' },
    10: { name: '액션 선택', intro: '탈출에 [바운스]와 [서드맨] 중 무엇이 나은지 판단하라!', zone: '전진 하프스페이스' },
    11: { name: '측면 과부하', intro: '상대가 좌측을 과부하시켰다. 사이드를 전환하라!', zone: '약측 탈출구' },
    12: { name: '추격하는 파수꾼', intro: '빠른 추격자가 중앙을 막는다. 전술 움직임을 써라!', zone: '포켓 존' },
    13: { name: '측면 압박 트랩', intro: '드롭 피벗이나 서드맨 연계로 측면 트랩을 깨라!', zone: '빈 포켓' },
    14: { name: '중앙 밀집', intro: '중앙이 막혔다. 블록을 우회하라!', zone: '존 14' },
    15: { name: '하프스페이스 침투', intro: '수비 블록을 뚫고 목표 하프스페이스로 침투하라!', zone: '우측 하프스페이스' },
    16: { name: '4-4-2 하이프레스 격파', intro: '상대가 촘촘한 4-4-2로 수비한다. 1선을 돌파하라!', zone: '라인 사이' },
    17: { name: '4-3-3 미드프레스 격파', intro: '3톱 전방 압박 트랩을 탈출하라!', zone: '딥 피벗' },
    18: { name: '맨마킹 블록', intro: '모든 동료가 밀착 마크된다. 전술 움직임으로 흔들어라!', zone: '피벗 공간' },
    19: { name: '측면 트랩 탈출', intro: '상대가 측면을 봉쇄했다. 전환이나 바운스로 탈출하라!', zone: '고립 지역' },
    20: { name: '빌드업 마스터클래스', intro: '모든 전술 도구를 동원해 공격적 하이프레스를 격파하라!', zone: '탈출 존' },
    21: { name: '수비 유인하기', intro: '볼을 캐리해 수비를 끌어당겨 프리맨에게 패스 길을 열어주세요!', zone: 'AM 포켓' },
    22: { name: '서드맨 론도', intro: '전방 패스 길이 막혔습니다. 다른 동료를 거치는 3자 패스로 탈출하세요!', zone: '약측 LHS' },
    23: { name: '유인 후 전환', intro: '바운스 패스로 압박을 중앙으로 모은 뒤, 고립된 반대 측면 윙어에게 크게 전환하세요!', zone: '고립 윙' },
    24: { name: '라 살리다 라볼피아나', intro: '피벗을 센터백 사이로 내려 2톱 전방 압박을 무력화하세요!', zone: '존 14' },
    25: { name: 'GED FUTBOL 마스터클래스', intro: '모든 전술 도구를 조합하여 상대 미드블록 전체를 무너뜨리세요!', zone: 'LHS 포켓' },
  },
  ja: {
    1:  { name: 'フリーマンを探せ', intro: 'ピボットゾーンのフリーな味方へパス!', zone: 'ピボットゾーン' },
    2:  { name: 'プレスを回避', intro: '守備者のプレス範囲を迂回しよう!', zone: 'サイドエリア' },
    3:  { name: 'カバーシャドウ突破', intro: 'レーンを塞ぐオレンジのカバーシャドウに注意!', zone: 'ハーフスペース' },
    4:  { name: '動くプレス', intro: '巡回するMFが離れる瞬間を狙え!', zone: 'ポケットエリア' },
    5:  { name: 'ミドルブロックの壁', intro: '2枚の守備ラインを抜く道を探せ!', zone: '前進ピボット' },
    6:  { name: 'ワンツー入門', intro: '[ワンツー]で素早く繋ぎプレスを回避!', zone: '逆サイド' },
    7:  { name: '3人目のコンビ', intro: '[3人目]で繋ぎ、ブラインドサイドの抜け出しを起動!', zone: 'ライン間' },
    8:  { name: 'サイドチェンジ!', intro: '[展開]で逆サイドのウインガーを活かせ!', zone: 'アイソレーションゾーン' },
    9:  { name: 'ピボット落とし', intro: '[ドロップDM]でMFを下げパスの角度を作れ!', zone: 'フリースペース' },
    10: { name: 'アクション選択', intro: '脱出に[ワンツー]か[3人目]か見極めろ!', zone: '前進ハーフスペース' },
    11: { name: 'サイド過密', intro: '相手が左サイドを過密化。サイドを変えろ!', zone: '逆サイド脱出' },
    12: { name: '追走の番人', intro: '速い追走者が中央を塞ぐ。戦術的な動きを使え!', zone: 'ポケットゾーン' },
    13: { name: 'サイドのプレス罠', intro: 'ドロップや3人目の連携でサイドの罠を破れ!', zone: 'フリーポケット' },
    14: { name: '中央の密集', intro: '中央が混雑。ブロックを迂回しろ!', zone: 'ゾーン14' },
    15: { name: 'ハーフスペース侵入', intro: '守備ブロックを破り狙いのハーフスペースへ侵入!', zone: '右ハーフスペース' },
    16: { name: '4-4-2ハイプレス攻略', intro: '相手はコンパクトな4-4-2。第一ラインを破れ!', zone: 'ライン間' },
    17: { name: '4-3-3ミドルプレス攻略', intro: '3トップの前線プレス罠を脱出しろ!', zone: 'ディープピボット' },
    18: { name: 'マンマーク型ブロック', intro: '味方全員がタイトにマーク。動きでずらせ!', zone: 'ピボットの穴' },
    19: { name: 'サイド罠からの脱出', intro: '相手がサイドを封鎖。展開かワンツーで脱出!', zone: 'アイソレーションエリア' },
    20: { name: 'ビルドアップ総仕上げ', intro: '全ての戦術ツールを使い積極的ハイプレスを攻略!', zone: '脱出ゾーン' },
    21: { name: 'ピン留め＆誘引', intro: 'ボールをキャリーして守備を引き付け、フリーマンへのパスラインを開こう！', zone: 'AMポケット' },
    22: { name: '3人目のロンド', intro: '前線へのパスラインが塞がれました。コネクター経由の3人目のパスで脱出！', zone: '逆サイドLHS' },
    23: { name: '誘引して広く展開', intro: 'ワンツーでプレスを中央に集め、孤立した逆サイドのウインガーへ大きく展開！', zone: '孤立ウイング' },
    24: { name: 'ラ・サリダ・ラボルピアーナ', intro: 'アンカーをCBの間に下ろし、2トップの前線プレスを無力化！', zone: 'ゾーン14' },
    25: { name: 'GED FUTBOLマスタークラス', intro: 'すべての戦術ツールを組み合わせ、相手ミドルブロック全体を崩壊させよう！', zone: 'LHSポケット' },
  },
};

// World-stage match flavor per level: stage / our shape / opp shape / concept.
// English source lives on the level objects (WORLD_STAGE_CONTEXTS in levels.js).
const FLAVOR_TR = {
  ko: {
    1:  { stage: '조별리그 - 초반 압박', our: '3-2 빌드업', opp: '4-4-2 중간 압박', concept: '프리 피벗 찾기' },
    2:  { stage: '조별리그 - 측면 트랩', our: '2-3 빌드업', opp: '볼사이드 압박', concept: '압박자 우회' },
    3:  { stage: '조별리그 - 섀도 라인', our: '3-1-1 탈출', opp: '커버 섀도 압박', concept: '섀도 레인 돌파' },
    4:  { stage: '조별리그 - 움직이는 블록', our: '3-2 로테이션', opp: '이동 미드블록', concept: '순찰 간격 노리기' },
    5:  { stage: '조별리그 - 전진 필수', our: '2-3-1 빌드업', opp: '2선 블록', concept: '미드블록 가르기' },
    6:  { stage: '조별리그 - 흐름 전환', our: '2-2 박스', opp: '1선 압박', concept: '압박 주변 바운스' },
    7:  { stage: '조별리그 - 블라인드 사이드', our: '3-2 지원', opp: '컴팩트 압박', concept: '서드맨 침투' },
    8:  { stage: '조별리그 - 약측', our: '3-1-2 빌드업', opp: '볼사이드 압축', concept: '고립 측면 전환' },
    9:  { stage: '조별리그 - 피벗 하강', our: '2-1 레스트 셰이프', opp: '중앙 봉쇄', concept: '피벗 각 만들기' },
    10: { stage: '조별리그 - 마지막 기회', our: '3-2 빌드업', opp: '하이브리드 압박', concept: '올바른 액션 선택' },
    11: { stage: '16강 - 과부하', our: '3-2 와이드 베이스', opp: '측면 과부하', concept: '약측 탈출' },
    12: { stage: '16강 - 회복 압박', our: '2-3 빌드업', opp: '추격 압박', concept: '전술 움직임 활용' },
    13: { stage: '16강 - 터치라인 트랩', our: '3-1 와이드 출구', opp: '측면 트랩', concept: '측면 트랩 돌파' },
    14: { stage: '16강 - 중앙 봉쇄', our: '2-3 내로우', opp: '중앙 컴팩트 블록', concept: '밀집 우회' },
    15: { stage: '16강 - 하프스페이스 침투', our: '3-2-1', opp: '미드블록 스크린', concept: '하프스페이스 진입' },
    16: { stage: '8강 - 하이프레스', our: '3-2 빌드업', opp: '4-4-2 하이프레스', concept: '1선 돌파' },
    17: { stage: '8강 - 프런트 스리', our: '2-3 빌드업', opp: '4-3-3 중간 압박', concept: '딥 피벗 찾기' },
    18: { stage: '8강 - 맨마킹', our: '3-1 지원', opp: '맨마킹 블록', concept: '마커 흔들기' },
    19: { stage: '8강 - 측면 압축', our: '2-3 와이드 베이스', opp: '측면 봉쇄 압박', concept: '측면 봉쇄 탈출' },
    20: { stage: '8강 - 마스터 프레스', our: '3-2-2 빌드업', opp: '공격적 하이프레스', concept: '모든 도구 조합' },
    21: { stage: '4강 - 압박 유인', our: '3-2 인내 베이스', opp: '컴팩트 압박', concept: '캐리로 유인' },
    22: { stage: '4강 - 서드맨', our: '3-1-2', opp: '레인 스크린', concept: '세 번째 선수 활용' },
    23: { stage: '4강 - 전환 순간', our: '2-3-1', opp: '안쪽 붕괴', concept: '유인 후 전환' },
    24: { stage: '결승 - 투톱 압박', our: '라볼피아나 3', opp: '2톱 하이프레스', concept: '센터백 사이 피벗 하강' },
    25: { stage: '결승 - 우승의 순간', our: '3-2-2 마스터클래스', opp: '풀 미드블록', concept: '블록 완전 해체' },
  },
  ja: {
    1:  { stage: 'グループステージ - 序盤プレス', our: '3-2 ビルドアップ', opp: '4-4-2 ミドルプレス', concept: 'フリーのピボットを探す' },
    2:  { stage: 'グループステージ - サイドの罠', our: '2-3 ビルドアップ', opp: 'ボールサイドプレス', concept: 'プレス回避' },
    3:  { stage: 'グループステージ - シャドウライン', our: '3-1-1 脱出', opp: 'カバーシャドウプレス', concept: 'シャドウレーン突破' },
    4:  { stage: 'グループステージ - 動くブロック', our: '3-2 ローテーション', opp: '可変ミドルブロック', concept: '巡回の隙を待つ' },
    5:  { stage: 'グループステージ - 前進必須', our: '2-3-1 ビルドアップ', opp: '2ラインブロック', concept: 'ミドルブロックを割る' },
    6:  { stage: 'グループステージ - 流れの転換', our: '2-2 ボックス', opp: '第1ラインプレス', concept: 'プレス周りでワンツー' },
    7:  { stage: 'グループステージ - ブラインドサイド', our: '3-2 サポート', opp: 'コンパクトプレス', concept: '3人目の侵入' },
    8:  { stage: 'グループステージ - 逆サイド', our: '3-1-2 ビルドアップ', opp: 'ボールサイド圧縮', concept: '孤立へサイドチェンジ' },
    9:  { stage: 'グループステージ - ピボット落とし', our: '2-1 レストシェイプ', opp: '中央ロック', concept: 'ピボットの角度作り' },
    10: { stage: 'グループステージ - ラストチャンス', our: '3-2 ビルドアップ', opp: 'ハイブリッドプレス', concept: '正しいアクション選択' },
    11: { stage: 'ベスト16 - オーバーロード', our: '3-2 ワイドベース', opp: 'サイド過密', concept: '逆サイドへ脱出' },
    12: { stage: 'ベスト16 - 回収プレス', our: '2-3 ビルドアップ', opp: '追走プレス', concept: '戦術的な動き' },
    13: { stage: 'ベスト16 - タッチライン罠', our: '3-1 ワイド出口', opp: 'サイドの罠', concept: 'サイドの罠を破る' },
    14: { stage: 'ベスト16 - 中央ロック', our: '2-3 ナロー', opp: '中央コンパクトブロック', concept: '密集を迂回' },
    15: { stage: 'ベスト16 - ハーフスペース侵入', our: '3-2-1', opp: 'ミドルブロックスクリーン', concept: 'ハーフスペースへ侵入' },
    16: { stage: '準々決勝 - ハイプレス', our: '3-2 ビルドアップ', opp: '4-4-2 ハイプレス', concept: '第一ライン突破' },
    17: { stage: '準々決勝 - フロントスリー', our: '2-3 ビルドアップ', opp: '4-3-3 ミドルプレス', concept: 'ディープピボットを探す' },
    18: { stage: '準々決勝 - マンマーク', our: '3-1 サポート', opp: 'マンマークブロック', concept: 'マーカーを剥がす' },
    19: { stage: '準々決勝 - サイド圧縮', our: '2-3 ワイドベース', opp: 'サイド封鎖プレス', concept: 'サイド封鎖を脱出' },
    20: { stage: '準々決勝 - マスタープレス', our: '3-2-2 ビルドアップ', opp: '積極的ハイプレス', concept: '全ツールを組み合わせ' },
    21: { stage: '準決勝 - プレス誘引', our: '3-2 我慢のベース', opp: 'コンパクトプレス', concept: 'キャリーで誘引' },
    22: { stage: '準決勝 - 3人目', our: '3-1-2', opp: 'レーンスクリーン', concept: '3人目を使う' },
    23: { stage: '準決勝 - 切替の瞬間', our: '2-3-1', opp: '内側の収縮', concept: '誘引してサイドチェンジ' },
    24: { stage: '決勝 - 2トッププレス', our: 'ラボルピアーナ3', opp: '2トップハイプレス', concept: 'CB間にピボットを落とす' },
    25: { stage: '決勝 - タイトルの瞬間', our: '3-2-2 マスタークラス', opp: 'フルミドルブロック', concept: 'ブロックを完全解体' },
  },
};

let __lang = I18N_DEFAULT;
try {
  const saved = (typeof localStorage !== 'undefined') && localStorage.getItem(I18N_STORAGE_KEY);
  if (saved && I18N_LANGS.indexOf(saved) !== -1) __lang = saved;
} catch (e) { /* storage blocked */ }

function getLang() { return __lang; }

function setLang(lang) {
  if (I18N_LANGS.indexOf(lang) === -1) return;
  __lang = lang;
  try { localStorage.setItem(I18N_STORAGE_KEY, lang); } catch (e) {}
}

function t(key, vars) {
  const table = I18N[__lang] || I18N.en;
  let s = (key in table) ? table[key] : (I18N.en[key] !== undefined ? I18N.en[key] : key);
  if (vars) {
    for (const k in vars) s = s.replace('{' + k + '}', vars[k]);
  }
  return s;
}

// Translated level field ('name' | 'intro' | 'zone'); English from window.LEVELS.
function tLevel(id, field) {
  const levels = (typeof window !== 'undefined' && window.LEVELS) ? window.LEVELS : [];
  const lvl = levels.find(l => l.id === id);
  if (__lang !== 'en' && LEVEL_TR[__lang] && LEVEL_TR[__lang][id] && LEVEL_TR[__lang][id][field]) {
    return LEVEL_TR[__lang][id][field];
  }
  if (!lvl) return '';
  if (field === 'zone') return lvl.targetZone ? lvl.targetZone.label : '';
  return lvl[field] || '';
}

// Translated world-stage flavor field ('stage'|'our'|'opp'|'concept'); EN from level objects.
function tFlavor(id, field) {
  if (__lang !== 'en' && FLAVOR_TR[__lang] && FLAVOR_TR[__lang][id] && FLAVOR_TR[__lang][id][field]) {
    return FLAVOR_TR[__lang][id][field];
  }
  const levels = (typeof window !== 'undefined' && window.LEVELS) ? window.LEVELS : [];
  const lvl = levels.find(l => l.id === id) || {};
  const en = { stage: lvl.stageLabel, our: lvl.ourShape, opp: lvl.opponentShape, concept: lvl.intendedConcept };
  return en[field] || '';
}

// Translated full channel name from a short code (LW/LHS/C/RHS/RW).
function tChannel(shortCode) { return t('channel.' + shortCode); }

if (typeof window !== 'undefined') {
  window.I18N = I18N;
  window.I18N_LANGS = I18N_LANGS;
  window.getLang = getLang;
  window.setLang = setLang;
  window.t = t;
  window.tLevel = tLevel;
  window.tChannel = tChannel;
  window.tFlavor = tFlavor;
}
