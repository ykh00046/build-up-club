let activeModal = null;
let restoreFocus = null;

// 배경 스크롤 잠금 — activeModal 유무 기준으로만 토글한다(모달 간 직접 전환 시
// 잠금이 잠깐 풀리는 것을 방지). 모달이 하나라도 떠 있으면 html/body 스크롤 잠금.
let savedScroll = null;
function applyScrollLock() {
  const docEl = document.documentElement;
  if (activeModal) {
    if (savedScroll === null) {
      savedScroll = { html: docEl.style.overflow, body: document.body.style.overflow };
      docEl.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
    }
  } else if (savedScroll !== null) {
    docEl.style.overflow = savedScroll.html;
    document.body.style.overflow = savedScroll.body;
    savedScroll = null;
  }
}

function setAppInert(value) {
  for (const el of document.querySelectorAll('body > header, body > main')) {
    el.inert = value;
  }
}

function focusableElements(root) {
  return [...root.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), ' +
    'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )].filter((el) => !el.hidden && el.offsetParent !== null);
}

export function openModal(overlay, focusTarget = null) {
  if (!overlay) return;
  if (activeModal && activeModal !== overlay) closeModal(activeModal, false);
  restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  activeModal = overlay;
  overlay.classList.add('visible');
  overlay.setAttribute('aria-hidden', 'false');
  setAppInert(true);
  applyScrollLock();
  requestAnimationFrame(() => {
    const target = focusTarget ?? focusableElements(overlay)[0] ?? overlay;
    target.focus();
  });
}

export function closeModal(overlay = activeModal, restore = true) {
  if (!overlay) return;
  overlay.classList.remove('visible');
  overlay.setAttribute('aria-hidden', 'true');
  const wasActive = activeModal === overlay;
  if (!wasActive) return;
  activeModal = null;
  setAppInert(false);
  applyScrollLock();
  if (restore && restoreFocus?.isConnected) restoreFocus.focus();
  restoreFocus = null;
}

document.addEventListener('keydown', (event) => {
  if (!activeModal) return;
  if (event.key === 'Escape' && activeModal.dataset.dismissible !== 'false') {
    event.preventDefault();
    closeModal();
    return;
  }
  if (event.key !== 'Tab') return;
  const items = focusableElements(activeModal);
  if (!items.length) {
    event.preventDefault();
    activeModal.focus();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});
