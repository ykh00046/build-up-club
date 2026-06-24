// 한국어 조사 자동 선택 — 앞 단어의 끝소리(받침) 기준으로 올바른 조사를 붙인다.
// 한글 음절은 유니코드 받침으로, 숫자/영문은 "읽는 소리"의 끝받침으로 판정한다.
// 예) '압박 강화' → '강화가'(받침 없음), 'ST(9)' → ')' 제거 후 9='구' → 'ST(9)가',
//     'L8' → 8='팔'(ㄹ받침) → 'L8이', 'GK' → K='케이' → 'GK가'.

// 숫자 0~9 한국어 읽기의 끝받침 유무: 영일×삼××육칠팔×
const DIGIT_BATCHIM = [true, true, false, true, false, false, true, true, true, false];
// 영문 알파벳 읽기(에이/비/씨…)의 끝받침: f엠ㅍ l엘ㄹ m엠ㅁ n엔ㄴ r아르ㄹ s에스ㅅ x엑스ㅅ z제트ㅌ
const ALPHA_BATCHIM = { f: 1, l: 1, m: 1, n: 1, r: 1, s: 1, x: 1, z: 1 };

// withB: 받침 있을 때 조사(이/은/을/과/으로), withoutB: 받침 없을 때(가/는/를/와/로).
// 반환값은 word + 선택된 조사 (템플릿에서 바로 사용).
export function josa(word, withB, withoutB) {
  const raw = String(word ?? '');
  const trimmed = raw.replace(/[)\]\s.]+$/, '');   // 끝의 ) ] 공백 마침표 제거 → 의미있는 끝글자
  const ch = trimmed[trimmed.length - 1];
  if (!ch) return raw + withoutB;
  const code = ch.charCodeAt(0);
  let batchim;
  if (code >= 0xAC00 && code <= 0xD7A3) batchim = ((code - 0xAC00) % 28) !== 0;  // 한글 음절 받침
  else if (ch >= '0' && ch <= '9') batchim = DIGIT_BATCHIM[+ch];
  else if (/[a-z]/i.test(ch)) batchim = !!ALPHA_BATCHIM[ch.toLowerCase()];
  else batchim = false;   // 그 외(기호 등)는 받침 없음으로 처리
  return raw + (batchim ? withB : withoutB);
}
