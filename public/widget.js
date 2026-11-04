// (function () {
//   const CONFIG = {
//     apiBase: "https://ai-dev.skay.ua",
//     shopName: "Skay.ua",
//   };

//   const API_CHAT = CONFIG.apiBase + "/api/chat";
//   const API_FEEDBACK = CONFIG.apiBase + "/api/feedback";
//   const API_HANDOFF = CONFIG.apiBase + "/api/handoff";
//   const BUNNY_IMG = CONFIG.apiBase + "/widget/assets/skay-bunny.jpg";

//   function uid() {
//     if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
//     return "sid-" + Math.random().toString(36).slice(2) + Date.now();
//   }

(function () {
  // Асети мають вантажитися поруч зі скриптом віджета. Це працює і для продакшн
  // маршруту /widget/, і для локального статичного preview без спеціальних rewrite-правил.
  const widgetScript = document.currentScript;
  const CONFIG = {
    apiBase: (widgetScript && widgetScript.getAttribute("data-api-base")) || "",
    shopName: "Skay.ua",
  };

  const API_CHAT = CONFIG.apiBase + "/api/chat";
  const API_FEEDBACK = CONFIG.apiBase + "/api/feedback";
  const API_HANDOFF = CONFIG.apiBase + "/api/handoff";
  const WIDGET_BASE = widgetScript && widgetScript.src
    ? new URL(".", widgetScript.src).href.replace(/\/$/, "")
    : CONFIG.apiBase + "/widget";
  const BUNNY_IMG = WIDGET_BASE + "/assets/skay-bunny.jpg";

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "sid-" + Math.random().toString(36).slice(2) + Date.now();
  }


  // ── Сесія чату ───────────────────────────────────────────────────────────
  // Одне сховище: sessionId + історія повідомлень + чи відкритий чат.
  // Живе між сторінками й вкладками сайту, поки є активність.
  // Сесія закінчується через SESSION_TTL_MS без нових повідомлень — тоді все стирається.
  // ВАЖЛИВО: значення має збігатися з SESSION_TTL_MS на сервері (lib/chatController.js),
  // інакше екран і памʼять AI розійдуться.
  const SESSION_KEY = "skay_ai_session_v1";
  const SESSION_TTL_MS = 30 * 60 * 1000;
  const MAX_STORED_MSGS = 40;

  let memState = null; // запасний варіант, якщо localStorage недоступний (приватний режим тощо)
  const storageOk = (function () {
    try {
      localStorage.setItem("skay_ai_probe", "1");
      localStorage.removeItem("skay_ai_probe");
      return true;
    } catch (e) {
      return false;
    }
  })();

  // старий ключ (до цієї версії) — прибираємо, щоб не висів у браузері
  try { localStorage.removeItem("skay_ai_session_id"); } catch (e) {}

  function readState() {
    let st = null;
    if (storageOk) {
      try { st = JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch (e) { st = null; }
    } else {
      st = memState;
    }
    if (st && st.v === 1 && st.sid && Array.isArray(st.msgs) && Date.now() - st.ts < SESSION_TTL_MS) return st;
    if (st) clearState(); // прострочена або пошкоджена — стираємо
    return null;
  }

  function writeState(st) {
    if (!storageOk) { memState = st; return true; }
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(st)); return true; } catch (e) { return false; }
  }

  function clearState() {
    memState = null;
    if (storageOk) { try { localStorage.removeItem(SESSION_KEY); } catch (e) {} }
  }

  function getState() {
    let st = readState();
    if (!st) {
      st = { v: 1, sid: uid(), ts: Date.now(), open: false, msgs: [] };
      writeState(st);
    }
    return st;
  }

  // touch=true тільки для реальної активності в чаті (повідомлення) — вона продовжує сесію.
  // Відкриття сторінки чи чату сесію не продовжує, щоб клієнт і сервер закінчували її одночасно.
  function mutateState(fn, touch) {
    const st = getState();
    fn(st);
    if (touch) st.ts = Date.now();
    if (st.msgs.length > MAX_STORED_MSGS) st.msgs = st.msgs.slice(-MAX_STORED_MSGS);
    if (!writeState(st)) {
      // не влізло в квоту — відрізаємо найстаріші, поки не влізе
      while (st.msgs.length > 2) {
        st.msgs.shift();
        if (writeState(st)) break;
      }
    }
    return st;
  }

  function getSessionId() {
    return getState().sid;
  }

  const STYLES = `
  .skai-panel, .skai-panel *, .skai-launcher {
    -webkit-tap-highlight-color: transparent;
  }
  .skai-launcher {
    position: fixed; right: 24px; bottom: 24px; z-index: 999998;
    width: 62px; height: 62px; border-radius: 50%; border: none; cursor: pointer; padding: 0;
    background: linear-gradient(145deg, #ffb6d5 0%, #ff8ec2 45%, #ff6aae 100%);
    box-shadow:
      0 10px 28px rgba(255,105,174,0.45),
      0 2px 6px rgba(255,105,174,0.30),
      inset 0 1px 1px rgba(255,255,255,0.65);
    display: flex; align-items: center; justify-content: center;
    overflow: visible; -webkit-tap-highlight-color: transparent;
    animation: skai-launcher-in .7s cubic-bezier(.34,1.45,.5,1) .15s both;
    transition: transform .45s cubic-bezier(.34,1.45,.5,1), box-shadow .35s ease, filter .3s ease;
  }
  .skai-launcher-face {
    position: relative; width: 52px; height: 52px; border-radius: 50%; overflow: hidden;
    background: #ffe3f0; isolation: isolate; display: block; pointer-events: none;
    box-shadow: inset 0 0 0 1px rgba(255,255,255,0.7), 0 1px 3px rgba(190,40,110,0.25);
  }
  .skai-launcher-face img { mix-blend-mode: multiply; pointer-events: none; }
  .skai-launcher::before {
    content: ""; position: absolute; inset: 0; border-radius: 50%; pointer-events: none;
    box-shadow: 0 0 0 0 rgba(255,105,174,0.45);
    animation: skai-pulse 3.2s cubic-bezier(.4,0,.2,1) 1.2s infinite;
  }
  .skai-launcher:hover {
    transform: translateY(-2px) scale(1.08);
    filter: saturate(1.06);
    box-shadow:
      0 14px 34px rgba(255,105,174,0.55),
      0 3px 8px rgba(255,105,174,0.35),
      inset 0 1px 1px rgba(255,255,255,0.7);
  }
  .skai-launcher:active { transform: scale(.94); transition-duration: .15s; }
  .skai-launcher.skai-launcher-open::before { animation: none; }
  .skai-launcher svg { width: 44px; height: 44px; }
  @keyframes skai-launcher-in {
    0% { opacity: 0; transform: scale(.3) translateY(16px); }
    100% { opacity: 1; transform: scale(1) translateY(0); }
  }
  @keyframes skai-pulse {
    0% { box-shadow: 0 0 0 0 rgba(255,105,174,0.40); }
    60%, 100% { box-shadow: 0 0 0 16px rgba(255,105,174,0); }
  }

  .skai-panel {
    position: fixed; right: 24px; bottom: 100px; z-index: 999999;
    width: 380px; max-width: calc(100vw - 32px);
    height: 600px; max-height: calc(100vh - 140px);
    background: #fff; border-radius: 20px; overflow: hidden;
    border: 1px solid rgba(130, 69, 137, .11);
    box-shadow: 0 24px 70px rgba(43,21,51,.24), 0 6px 18px rgba(43,21,51,.10);
    display: flex; flex-direction: column; contain: layout paint;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
    transform-origin: bottom right;
    opacity: 0; visibility: hidden; pointer-events: none;
    transform: translateY(18px) scale(.86);
    will-change: transform, opacity;
    transition:
      transform .32s cubic-bezier(.4,0,.2,1),
      opacity .22s ease,
      visibility 0s linear .32s;
  }
  .skai-panel.skai-open {
    opacity: 1; visibility: visible; pointer-events: auto;
    transform: translateY(0) scale(1);
    transition:
      transform .6s cubic-bezier(.22,1,.36,1),
      opacity .35s cubic-bezier(.22,1,.36,1),
      visibility 0s linear 0s;
  }

  .skai-header {
    background: linear-gradient(135deg, #0C5BA8, #2153A4, #5B3E97, #8C2B8D, #B21D85, #CD1380, #DD0D7C, #E30B7B);
    padding: 16px 18px; display: flex; align-items: center; gap: 12px; color: #fff;
    flex-shrink: 0; position: relative; overflow: hidden;
  }
  .skai-header::after {
    content: ""; position: absolute; inset: 0; pointer-events: none;
    background: linear-gradient(115deg, rgba(255,255,255,.15), transparent 36%, rgba(255,255,255,.06));
  }
  .skai-avatar, .skai-header-text, .skai-close { position: relative; z-index: 1; }
  .skai-avatar {
    width: 42px; height: 42px; border-radius: 50%; background: #ffe3f0;
    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
    isolation: isolate; overflow: hidden; box-shadow: 0 2px 8px rgba(34,12,60,.2), inset 0 0 0 1px rgba(255,255,255,.75);
  }
  .skai-avatar svg { width: 34px; height: 34px; }
  .skai-header-text { flex: 1; min-width: 0; }
  .skai-title-row { display: flex; align-items: center; gap: 8px; }
  .skai-title { font-weight: 700; font-size: 16px; }
  .skai-beta {
    font-size: 10px; font-weight: 700; background: rgba(255,255,255,0.25);
    padding: 2px 8px; border-radius: 20px; letter-spacing: .3px; border: 1px solid rgba(255,255,255,.2);
  }
  .skai-status { font-size: 12.5px; opacity: 0.9; display: flex; align-items: center; gap: 5px; margin-top: 2px; }
  .skai-dot { width: 7px; height: 7px; border-radius: 50%; background: #54e497; display: inline-block; box-shadow: 0 0 0 3px rgba(84,228,151,.17); animation: skai-online 2.8s ease-in-out infinite; }
  .skai-close {
    width: 32px; height: 32px; border-radius: 50%; border: none; cursor: pointer;
    background: rgba(255,255,255,0.22); color: #fff; font-size: 16px; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center; transition: transform .2s ease, background .2s ease;
  }
  .skai-close:hover { background: rgba(255,255,255,.32); transform: rotate(90deg); }
  .skai-close:active { transform: rotate(90deg) scale(.9); }
  @keyframes skai-online { 50% { box-shadow: 0 0 0 5px rgba(84,228,151,0); } }

  .skai-body {
    flex: 1; overflow-y: auto; overflow-x: hidden; padding: 16px; background: #fdf7fb;
    display: flex; flex-direction: column; gap: 14px; scrollbar-width: thin; scrollbar-color: #d9bdd6 transparent;
  }
  .skai-body::-webkit-scrollbar { width: 7px; }
  .skai-body::-webkit-scrollbar-thumb { background: #d9bdd6; border: 2px solid #fdf7fb; border-radius: 10px; }
  .skai-msg-row { display: flex; gap: 10px; align-items: flex-start; }
  .skai-msg-row.skai-user { justify-content: flex-end; }
  .skai-msg-avatar {
    width: 30px; height: 30px; border-radius: 50%; flex-shrink: 0;
    background: #ffe3f0;
    display: flex; align-items: center; justify-content: center;
    padding: 3px; box-sizing: border-box; isolation: isolate;
  }
  .skai-avatar img, .skai-msg-avatar img { mix-blend-mode: multiply; }
  .skai-msg-avatar svg { width: 100%; height: 100%; }
  .skai-msg-col { display: flex; flex-direction: column; gap: 6px; max-width: 100%; min-width: 0; }
  .skai-line { display: flex; align-items: flex-end; gap: 10px; min-width: 0; }
  .skai-line .skai-bubble { min-width: 0; }
  .skai-msg-col > .skai-metarow { width: calc(100% - 40px); margin-left: 40px; }
  .skai-msg-col > .skai-cards, .skai-msg-col > .skai-filterchips, .skai-msg-col > .skai-op-actions { margin-left: 40px; }
  .skai-msg-col > .skai-cards { max-width: calc(100% - 40px); }
  #skai-typing-row { align-items: flex-end; }
  .skai-user-col { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; max-width: 80%; min-width: 0; }
  .skai-bubble {
    background: #fff; border-radius: 17px 17px 17px 4px; padding: 10px 14px; font-size: 14.5px;
    line-height: 1.48; color: #2b1533; max-width: 100%; box-shadow: 0 1px 2px rgba(43,21,51,.07), 0 1px 1px rgba(43,21,51,.04);
    white-space: pre-wrap; word-wrap: break-word; box-sizing: border-box; border: 1px solid rgba(100,63,106,.06);
  }
  .skai-user .skai-bubble {
    background: #C4E2FF; color: #0B3D66; border: 1px solid #a9d3f5;
    border-radius: 17px 17px 4px 17px;
    box-shadow: 0 1px 2px rgba(22,74,116,.1);
  }
  .skai-user .skai-meta { color: #6f9fc9; padding: 0 2px; }

  .skai-cards { display: flex; flex-direction: column; gap: 8px; margin-top: 2px; max-width: 92%; }
  .skai-showmore {
    align-self: flex-start; border: 1px solid #C4E2FF; background: #fff; color: #0B3D66;
    font-size: 12.5px; font-weight: 600; padding: 7px 14px; border-radius: 20px; cursor: pointer;
    margin-top: 2px; transition: background .2s ease, border-color .2s ease, transform .2s ease, box-shadow .2s ease;
  }
  .skai-showmore:hover { background: #EAF4FF; border-color: #6fa8dc; transform: translateY(-1px); box-shadow: 0 3px 8px rgba(29,111,184,.12); }
  .skai-card {
    display: flex; gap: 12px; background: #fff; border: 1px solid #f2e6f4; border-radius: 15px;
    padding: 10px; text-decoration: none; color: inherit; align-items: center;
    box-shadow: 0 1px 2px rgba(43,21,51,.05);
    transition: box-shadow .22s ease, transform .22s cubic-bezier(.2,.8,.2,1), border-color .22s ease, background .22s ease;
  }
  .skai-card:hover { box-shadow: 0 9px 20px rgba(43,21,51,.12); transform: translateY(-2px); border-color: #e7cfe9; background: #fffdfd; }
  .skai-card img { width: 52px; height: 52px; object-fit: contain; border-radius: 10px; background: #f7f2f8; flex-shrink: 0; }
  .skai-card-info { min-width: 0; flex: 1; }
  .skai-card-name {
    font-size: 13px; font-weight: 600; color: #2b1533;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    overflow: hidden; line-height: 1.32;
  }
  .skai-card-meta { font-size: 12.5px; margin-top: 3px; display: flex; flex-wrap: wrap; gap: 5px 6px; align-items: center; }
  .skai-card-price { font-weight: 700; color: #B21D85; white-space: nowrap; }
  .skai-card-oldprice { font-weight: 500; color: #b19aac; text-decoration: line-through; font-size: 11.5px; white-space: nowrap; }
  .skai-card-discount {
    font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 20px;
    background: #ffe1ea; color: #c9126b;
  }
  .skai-card-tag {
    font-size: 10px; font-weight: 700; padding: 1px 7px; border-radius: 20px;
    background: #f3e6fb; color: #8C2B8D; text-transform: uppercase; letter-spacing: .2px;
  }
  .skai-card-tag.skai-tag-alt { background: #ffe9d6; color: #b9560a; }
  .skai-card-unavail { color: #c23; font-size: 11.5px; margin-left: 4px; }

  .skai-filterchips { margin-top: 2px; }
  .skai-filterchips-label { font-size: 11.5px; color: #a892ae; font-weight: 600; margin: 8px 0 6px; }
  .skai-filterchips-label:first-child { margin-top: 0; }
  .skai-filterchips-row { display: flex; gap: 6px; flex-wrap: wrap; }
  /* Кнопки розділів/підкатегорій: охайна сітка 2 колонки, назва зліва, лічильник бейджем справа */
  .skai-optgrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
  .skai-opt {
    display: flex; align-items: center; justify-content: space-between; gap: 8px; text-align: left;
    border: 1px solid #C4E2FF; background: #fff; color: #0B3D66; font-size: 12.5px; font-weight: 600;
    line-height: 1.25; padding: 8px 10px; border-radius: 12px; cursor: pointer; min-height: 38px;
    font-family: inherit; transition: background .18s ease, border-color .18s ease, transform .18s ease, box-shadow .18s ease;
  }
  .skai-opt:hover { background: #EAF4FF; border-color: #6fa8dc; transform: translateY(-1px); box-shadow: 0 3px 8px rgba(29,111,184,.10); }
  .skai-opt:active { transform: scale(.98); }
  .skai-opt-name { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .skai-opt-count {
    flex: none; font-size: 11px; font-weight: 700; color: #0B3D66; background: #EAF4FF;
    border-radius: 10px; padding: 1px 7px; min-width: 22px; text-align: center;
  }
  .skai-opt.skai-opt-direct { border-style: dashed; background: #fbfdff; }
  .skai-opt.skai-opt-wide { grid-column: 1 / -1; }
  .skai-opt-back {
    display: inline-flex; align-items: center; gap: 4px; margin-top: 8px; border: none; background: transparent;
    color: #8C2B8D; font-size: 12.5px; font-weight: 600; padding: 4px 2px; cursor: pointer; font-family: inherit;
  }
  .skai-opt-back:hover { text-decoration: underline; }
  @media (max-width: 380px) { .skai-optgrid { grid-template-columns: minmax(0, 1fr); } }
  .skai-filterchip {
    border: 1px solid #C4E2FF; background: #fff; color: #0B3D66; font-size: 12.5px; font-weight: 600;
    padding: 6px 12px; border-radius: 20px; cursor: pointer; white-space: nowrap; transition: background .18s ease, border-color .18s ease, transform .18s ease, box-shadow .18s ease;
  }
  .skai-filterchip:hover { background: #EAF4FF; border-color: #6fa8dc; transform: translateY(-1px); box-shadow: 0 3px 8px rgba(29,111,184,.10); }

  .skai-bubble.skai-stores { white-space: normal; }
  .skai-stores-title { font-weight: 700; }
  .skai-stores-note { color: #6b5a70; font-size: 13px; margin-top: 2px; }
  .skai-stores-label {
    font-size: 11px; font-weight: 700; color: #a892ae; text-transform: uppercase;
    letter-spacing: .4px; margin: 12px 0 2px;
  }
  .skai-store { padding: 8px 0; border-top: 1px solid #f6eaf6; }
  .skai-store:first-of-type { border-top: none; }
  .skai-store-addr { display: block; font-weight: 600; color: #2b1533; text-decoration: none; }
  .skai-store-addr:hover { color: #B21D85; }
  .skai-store-line { font-size: 13px; color: #6b5a70; margin-top: 2px; }
  .skai-store-line a { color: #B21D85; text-decoration: none; font-weight: 600; }
  .skai-stores-all {
    display: inline-block; margin-top: 8px; font-size: 13px; font-weight: 600;
    color: #B21D85; text-decoration: none;
  }
  .skai-stores-all:hover, .skai-store-line a:hover { text-decoration: underline; }

  .skai-op-actions { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; max-width: calc(100% - 40px); box-sizing: border-box; }
  .skai-op-tg {
    display: flex; align-items: center; justify-content: center; gap: 8px; text-decoration: none;
    color: #fff; font-size: 13.5px; font-weight: 700; padding: 11px 16px; border-radius: 20px;
    width: 100%; box-sizing: border-box;
    background: linear-gradient(135deg, #0C5BA8, #2153A4, #5B3E97, #8C2B8D, #B21D85, #CD1380, #DD0D7C, #E30B7B);
    box-shadow: 0 2px 10px rgba(178,29,133,.3); transition: transform .15s, box-shadow .15s;
  }
  .skai-op-tg:hover { transform: translateY(-1px); box-shadow: 0 4px 14px rgba(178,29,133,.4); }
  .skai-op-tg:active { transform: scale(.97); box-shadow: 0 2px 8px rgba(178,29,133,.35); }
  .skai-op-tg svg { width: 17px; height: 17px; flex-shrink: 0; display: block; }
  .skai-op-phone {
    display: flex; align-items: center; justify-content: center; gap: 7px; text-decoration: none;
    background: #DCEBFF; color: #0B3D66; font-size: 13.5px; font-weight: 700; padding: 11px 16px; border-radius: 20px;
    width: 100%; box-sizing: border-box; transition: background .15s, transform .1s;
  }
  .skai-op-phone:hover { background: #C4E2FF; }
  .skai-op-phone:active { background: #B8DBFF; transform: scale(.97); }
  .skai-op-phone svg { width: 15px; height: 15px; flex-shrink: 0; }

  .skai-meta { font-size: 11px; color: #b19aac; }
  .skai-metarow { display: flex; align-items: center; justify-content: flex-end; gap: 4px; width: 100%; margin-top: 0; padding: 0 2px; box-sizing: border-box; }
  .skai-metarow > .skai-meta { margin-right: auto; }
  .skai-votes { display: flex; align-items: center; gap: 1px; opacity: 0.55; transition: opacity .15s ease; }
  .skai-msg-row:hover .skai-votes, .skai-votes.skai-voted { opacity: 1; }
  .skai-vote {
    border: none; background: transparent; cursor: pointer; color: #b3a0bb;
    width: 24px; height: 24px; padding: 0; border-radius: 7px; line-height: 1;
    display: flex; align-items: center; justify-content: center;
    transition: color .15s, background .15s, transform .15s;
  }
  .skai-vote svg { width: 13px; height: 13px; display: block; }
  .skai-vote-down svg { transform: rotate(180deg); }
  .skai-vote:hover { color: #0B67C2; background: #EAF4FF; border-color: #C4E2FF; transform: translateY(-1px); }
  .skai-vote-down:hover { color: #C62828; background: #FDECEC; border-color: #F4C7C7; }
  .skai-vote.active { color: #0B67C2; background: #EAF4FF; border-color: #9CCBFA; }
  .skai-vote-down.active { color: #C62828; background: #FDECEC; border-color: #F0AAAA; }
  .skai-panel img { -webkit-user-drag: none; user-select: none; }

  .skai-typing-bubble { display: flex; align-items: center; gap: 8px; }
  .skai-typing-label { font-size: 13.5px; color: #8a6a95; font-style: italic; }
  .skai-typing { display: flex; gap: 4px; padding: 6px 2px; }
  .skai-typing span {
    width: 6px; height: 6px; border-radius: 50%; background: #c9a8d6;
    animation: skai-bounce 1.2s infinite ease-in-out;
  }
  .skai-typing span:nth-child(2) { animation-delay: .15s; }
  .skai-typing span:nth-child(3) { animation-delay: .3s; }
  @keyframes skai-bounce { 0%,60%,100%{transform: translateY(0);} 30%{transform: translateY(-5px);} }
  /* Анімація відповіді: текст друкується, потім з'являються картки/кнопки */
  .skai-pending { opacity: 0; transform: translateY(10px); }
  .skai-rise { animation: skai-rise-in .45s cubic-bezier(.2,.7,.3,1) both; }
  .skai-spacer { flex-shrink: 0; pointer-events: none; }
  .skai-enter { animation: skai-rise-in .4s cubic-bezier(.2,.7,.3,1) both; }
  .skai-replies { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0 2px 40px; max-width: calc(100% - 40px); }
  .skai-quick-btn { border: 1px solid #cfe0f1; border-radius: 14px; padding: 7px 11px; background: #fff; color: #0B3D66; cursor: pointer; font-family: inherit; font-size: 13px; font-weight: 600; line-height: 1.2; box-shadow: 0 1px 2px rgba(29,111,184,.06); transition: transform .18s ease, background .18s ease, border-color .18s ease, box-shadow .18s ease; }
  .skai-quick-btn:hover { background: #EAF4FF; border-color: #94c4eb; transform: translateY(-1px); box-shadow: 0 4px 10px rgba(29,111,184,.12); }
  .skai-quick-btn:disabled { opacity: .45; cursor: default; background: transparent; }
  @keyframes skai-rise-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
  .skai-caret { display: inline-block; width: 2px; height: 1em; margin-left: 2px; background: currentColor; vertical-align: -0.15em; animation: skai-blink .9s steps(1) infinite; }
  @keyframes skai-blink { 50% { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) {
    .skai-rise { animation: none; }
    .skai-caret { display: none; }
  }

  .skai-quick {
    display: flex; gap: 8px; padding: 10px 14px; flex-wrap: wrap; flex-shrink: 0;
    background: #fdf7fb; border-top: 1px solid #f2e6f4;
  }
  .skai-quick button {
    border: none; background: #DCEBFF; color: #0B3D66; font-size: 12.5px; font-weight: 600;
    padding: 7px 12px; border-radius: 20px; cursor: pointer; white-space: nowrap;
    box-shadow: inset 0 0 0 1px rgba(11,61,102,.03); transition: background .18s ease, transform .18s ease, box-shadow .18s ease;
  }
  .skai-quick button:hover { background: #C4E2FF; transform: translateY(-1px); box-shadow: 0 3px 8px rgba(29,111,184,.12); }
  .skai-quick button:active { background: #B8DBFF; transform: scale(.97); }

  .skai-inputbar { padding: 12px 14px; background: #fff; border-top: 1px solid #f2e6f4; flex-shrink: 0; }
  .skai-inputrow { display: flex; align-items: center; gap: 8px; border: 1.6px solid #CD1380;
    border-radius: 30px; padding: 6px 6px 6px 16px; background: #fff; transition: border-color .2s ease, box-shadow .2s ease, background .2s ease; }
  .skai-inputrow:focus-within { border-color: #a32a99; background: #fffdfd; box-shadow: 0 0 0 4px rgba(205,19,128,.12); }
  .skai-inputrow input {
    flex: 1; border: none; outline: none; font-size: 14px; background: transparent; min-width: 0;
  }
  .skai-send {
    width: 38px; height: 38px; border-radius: 50%; border: none; cursor: pointer; flex-shrink: 0;
    background: linear-gradient(135deg, #0C5BA8, #2153A4, #5B3E97, #8C2B8D, #B21D85, #CD1380, #DD0D7C, #E30B7B); color: #fff;
    display: flex; align-items: center; justify-content: center; box-shadow: 0 3px 8px rgba(178,29,133,.28); transition: transform .2s cubic-bezier(.2,.8,.2,1), box-shadow .2s ease, filter .2s ease;
  }
  .skai-send:not(:disabled):hover { transform: translateY(-1px) scale(1.04); box-shadow: 0 5px 12px rgba(178,29,133,.35); filter: saturate(1.08); }
  .skai-send:not(:disabled):active { transform: scale(.92); }
  .skai-send:disabled { opacity: .5; cursor: default; }
  .skai-panel button:focus-visible, .skai-panel a:focus-visible, .skai-launcher:focus-visible { outline: 3px solid rgba(12,103,194,.42); outline-offset: 3px; }
  .skai-disclaimer { font-size: 11px; color: #a892ae; text-align: center; margin-top: 8px; }

  @media (max-width: 480px) {
    .skai-panel {
      right: 0; left: 0; bottom: 0; top: 0;
      width: 100%; max-width: 100%;
      height: 100%; max-height: 100%;
      border-radius: 0;
    }
    .skai-launcher { right: 16px; bottom: 16px; }
    .skai-panel { transform-origin: bottom center; transform: translateY(32px) scale(.98); }
    .skai-panel.skai-open { transform: translateY(0) scale(1); }
    .skai-header { padding: 14px 14px; padding-top: max(14px, env(safe-area-inset-top)); }
    .skai-body { padding: 14px; }
    .skai-bubble { font-size: 15px; }
    .skai-user-col { max-width: 84%; }
    .skai-cards { max-width: 94%; }
    .skai-quick { padding: 0 12px 10px; }
    .skai-quick button { font-size: 13px; padding: 8px 13px; }
    .skai-inputbar { padding-bottom: max(12px, env(safe-area-inset-bottom)); }
    .skai-inputrow input { font-size: 16px; }
  }

  @media (prefers-reduced-motion: reduce) {
    .skai-launcher, .skai-launcher::before, .skai-dot, .skai-typing span { animation: none; }
    .skai-panel, .skai-panel.skai-open { transition: opacity .15s linear, visibility 0s; transform: none; }
    .skai-panel *, .skai-launcher { scroll-behavior: auto; transition-duration: .01ms !important; }
  }
  `;

  function el(tag, props, children) {
    const e = document.createElement(tag);
    if (props) Object.assign(e, props);
    (children || []).forEach((c) => c && e.appendChild(c));
    return e;
  }

  function bunnyImg(size) {
    return `<img src="${BUNNY_IMG}" alt="Скай" draggable="false" style="width:${size}px;height:${size}px;object-fit:cover;border-radius:50%;display:block;" />`;
  }

  function thumbSVG() {
    return `<svg viewBox="0 0 24 24" fill="none"><path d="M7 22V10l5-8 1 1v6h6.5a1.5 1.5 0 0 1 1.46 1.83l-1.6 7A1.5 1.5 0 0 1 17.4 20H10a3 3 0 0 1-3-3V22Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
  }

  function sparkleSVG(color) {
    return `<svg viewBox="0 0 24 24" fill="none"><path d="M12 2l1.8 5.6L19 9l-5.2 1.9L12 16l-1.8-5.1L5 9l5.2-1.4L12 2z" fill="${color}"/></svg>`;
  }

  function telegramSVG() {
    return `<svg viewBox="0 0 448 512" width="16" height="16" fill="none"><path d="M446.7 98.6l-67.6 318.8c-5.1 22.5-18.4 28.1-37.3 17.5l-103-75.9-49.7 47.8c-5.5 5.5-10.1 10.1-20.6 10.1l7.4-104.9 190.7-172.2c8.3-7.4-1.8-11.5-12.9-4.1L117.5 283 15.7 250.1c-22.1-6.9-22.5-22.1 4.6-32.7L418.2 66.9c18.4-6.9 34.5 4.1 28.5 31.7z" fill="#fff"/></svg>`;
  }

  function phoneSVG() {
    return `<svg viewBox="0 0 24 24" fill="none"><path d="M6.6 10.8c1.4 2.8 3.8 5.2 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.4c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.4 0 .8-.2 1l-2.2 2.2z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
  }

  function buildWidget() {
    const style = document.createElement("style");
    style.textContent = STYLES;
    document.head.appendChild(style);

    const launcher = el("button", { type: "button", className: "skai-launcher", "aria-label": "Відкрити чат зі Скаєм", innerHTML: `<span class="skai-launcher-face">${bunnyImg(52)}</span>` });

    const panel = el("div", { className: "skai-panel" });
    panel.innerHTML = `
      <div class="skai-header">
        <div class="skai-avatar">${bunnyImg(42)}</div>
        <div class="skai-header-text">
          <div class="skai-title-row">
            <span class="skai-title">Скай</span>
            <span class="skai-beta">БЕТА</span>
          </div>
          <div class="skai-status"><span class="skai-dot"></span> ${CONFIG.shopName} · онлайн</div>
        </div>
        <button type="button" class="skai-close" aria-label="Закрити">✕</button>
      </div>
      <div class="skai-body" id="skai-body"></div>
      <div class="skai-quick" id="skai-quick">
        <button type="button" data-q="Покажи новинки">Показати новинки</button>
        <button type="button" data-q="Що зараз в розпродажі?">Що в розпродажі?</button>
        <button type="button" data-action="stores">Наші магазини</button>
        <button type="button" data-q="Зʼєднай мене з оператором">Зʼєднати з оператором</button>
      </div>
      <div class="skai-inputbar">
        <div class="skai-inputrow">
          <input id="skai-input" type="text" placeholder="Напишіть, що шукаєте..." />
          <button type="button" class="skai-send" id="skai-send" aria-label="Надіслати">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M3 11l18-8-8 18-2-8-8-2z" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>
          </button>
        </div>
        <div class="skai-disclaimer">AI може помилятись. Для точної наявності — уточнюйте у менеджера.</div>
      </div>
    `;

    document.body.appendChild(launcher);
    document.body.appendChild(panel);

    const body = panel.querySelector("#skai-body");
    const input = panel.querySelector("#skai-input");
    const sendBtn = panel.querySelector("#skai-send");
    const closeBtn = panel.querySelector(".skai-close");
    const quick = panel.querySelector("#skai-quick");

    let opened = false;
    function toggle(force) {
      opened = typeof force === "boolean" ? force : !opened;
      panel.classList.toggle("skai-open", opened);
      launcher.classList.toggle("skai-launcher-open", opened);
      if (opened && !body.dataset.greeted) {
        greet();
        body.dataset.greeted = "1";
      }
      if (!restoring) mutateState((st) => { st.open = opened; }, false);
    }
    window.__skaiClose = function () {
      if (opened) toggle(false);
      else mutateState((st) => { st.open = false; }, false);
    };
    launcher.addEventListener("click", () => toggle());
    closeBtn.addEventListener("click", () => toggle(false));

    function greet() {
      addBotBubble(
        `Привіт! Я Скай — AI-консультант ${CONFIG.shopName} 💖 Напишіть, що шукаєте — модель, бюджет або просто "чохол на 17 про макс", і я підберу варіанти з каталогу.`
      );
    }

    function scrollDown() {
      body.scrollTop = body.scrollHeight;
    }

    function nowLabel(ts) {
      if (!ts) return "щойно";
      const min = Math.floor((Date.now() - ts) / 60000);
      if (min < 1) return "щойно";
      if (min < 60) return `${min} хв тому`;
      return new Date(ts).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
    }

    // ── історія повідомлень у сесії ──
    let restoring = false;               // true, поки відтворюємо збережене (нічого не записуємо повторно)
    let activeSid = getState().sid;      // сесія, якій зараз відповідає вміст вікна чату

    function shortId() {
      return Math.random().toString(36).slice(2, 10);
    }

    function record(entry) {
      if (restoring) return;
      mutateState((st) => { st.msgs.push(entry); }, true);
    }

    function addUserBubble(text, ts) {
      body.querySelectorAll(".skai-spacer").forEach((n) => n.remove());
      const stamp = ts || Date.now();
      const row = el("div", { className: "skai-msg-row skai-user" }, [
        el("div", { className: "skai-user-col" }, [
          el("div", { className: "skai-bubble", textContent: text }),
          el("div", { className: "skai-meta", textContent: nowLabel(ts) }),
        ]),
      ]);
      body.appendChild(row);
      scrollDown();
      record({ k: "u", text, ts: stamp });
    }

    // kind "service" — контакти МайстерСКАЯ (ремонт), "sales" (за замовчуванням) — звичайний оператор.
    function buildOperatorActions(kind) {
      const tgUrl = kind === "service" ? SERVICE_TG_URL : OPERATOR_TG_URL;
      const phone = kind === "service" ? SERVICE_PHONE : OPERATOR_PHONE;
      const phoneHref = kind === "service" ? SERVICE_PHONE_HREF : OPERATOR_PHONE_HREF;
      const wrap = el("div", { className: "skai-op-actions" });
      wrap.appendChild(
        el("a", {
          className: "skai-op-tg",
          href: tgUrl,
          target: "_blank",
          rel: "noopener",
          innerHTML: `${telegramSVG()}<span>Написати в Telegram</span>`,
        })
      );
      wrap.appendChild(
        el("a", {
          className: "skai-op-phone",
          href: phoneHref,
          innerHTML: `${phoneSVG()}<span>${phone}</span>`,
        })
      );
      return wrap;
    }

    // Коли саме повідомлення бота мимохідь згадує "оператора"/"менеджера" (не лише через
    // клік по кнопці "Зʼєднати з оператором") — все одно показуємо кнопки зв'язку, щоб
    // клієнту не доводилось шукати номер самому. Згадка ремонту/МайстерСКАЯ — окремі контакти.
    const SERVICE_MENTION_RE = /майстерск|ремонт/iu;
    const OPERATOR_MENTION_RE = /оператор|менеджер/iu;
    function resolveOperatorActionKind(text, userMessage) {
      // Кнопка та введений вручну запит можуть містити різні типи апострофа.
      // Досить розпізнати намір у повідомленні користувача, а не вимагати точного рядка.
      if (OPERATOR_MENTION_RE.test(String(userMessage || ""))) return "sales";
      const t = String(text || "");
      if (SERVICE_MENTION_RE.test(t)) return "service";
      if (OPERATOR_MENTION_RE.test(t)) return "sales";
      return null;
    }

    const REDUCE_MOTION = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

    // Поточна анімація друку (лише одна за раз). Нова відповідь або нове повідомлення
    // миттєво дописує попередню, щоб два таймери не боролися за скрол і текст.
    let activeTyping = null;

    function finishActiveTyping() {
      if (activeTyping) {
        activeTyping();
        activeTyping = null;
      }
    }

    // Друк по символах (code points, щоб емодзі не ламались). Друк ніяк не рухає скрол:
    // початок відповіді вже закріплений вгорі, а текст короткий і вміщується в зону видимості.
    function typeText(node, text) {
      return new Promise((resolve) => {
        if (REDUCE_MOTION || !text) {
          node.textContent = text;
          resolve();
          return;
        }
        const chars = Array.from(text);
        const total = chars.length;
        const tn = document.createTextNode("");
        const caret = el("span", { className: "skai-caret" });
        node.textContent = "";
        node.appendChild(tn);
        node.appendChild(caret);
        const chunk = Math.max(1, Math.ceil(total / 110));
        let i = 0;
        let done = false;

        const finish = () => {
          if (done) return;
          done = true;
          clearInterval(timer);
          tn.data = text;
          setTimeout(() => caret.remove(), 300);
          resolve();
        };
        const timer = setInterval(() => {
          i = Math.min(total, i + chunk);
          tn.data = chars.slice(0, i).join("");
          if (i >= total) finish();
        }, 22);
        activeTyping = finish;
      });
    }

    // Закріплює вгорі видимої області запит користувача і відповідь бота разом.
    // Розпірка під відповіддю дає місце для прокрутки, тому короткий діалог можна підняти вгору.
    function pinTop(row) {
      body.querySelectorAll(".skai-spacer").forEach((n) => n.remove());
      const prev = row.previousElementSibling;
      const anchor = prev && prev.classList.contains("skai-user") ? prev : row;
      const span = row.getBoundingClientRect().bottom - anchor.getBoundingClientRect().top;
      const need = Math.max(0, body.clientHeight - span - 24);
      const sp = el("div", { className: "skai-spacer" });
      sp.style.height = need + "px";
      body.appendChild(sp);
      const offset = anchor.getBoundingClientRect().top - body.getBoundingClientRect().top;
      body.scrollTop += offset - 10;
    }

    // Елементи з'являються плавно, коли потрапляють у видиму частину списку (під час прокрутки),
    // а не за таймером. Без IntersectionObserver — одразу.
    function revealOnView(nodes) {
      const show = (n) => {
        n.classList.remove("skai-pending");
        n.classList.add("skai-rise");
      };
      if (!("IntersectionObserver" in window)) {
        nodes.forEach(show);
        return;
      }
      const io = new IntersectionObserver(
        (entries) => {
          entries.forEach((en) => {
            if (en.isIntersecting) {
              show(en.target);
              io.unobserve(en.target);
            }
          });
        },
        { root: body, threshold: 0.12 }
      );
      nodes.forEach((n) => {
        n.classList.add("skai-pending");
        io.observe(n);
      });
    }

    // Елементи, які треба поступово показувати: картки окремо, решта — цілим блоком
    function collectReveal(groups) {
      const out = [];
      groups.forEach((g) => {
        if (g.classList.contains("skai-cards")) out.push(...Array.from(g.children));
        else out.push(g);
      });
      return out;
    }

    function addBotBubble(text, cards, filters, meta) {
      meta = meta || {};
      const id = meta._id || shortId();
      const stamp = meta._ts || Date.now();
      if (!meta.transient) {
        record({ k: "b", id, text, cards: cards || null, filters: filters || null, um: meta.userMessage || null, ts: stamp });
      }
      meta = Object.assign({}, meta, {
        _ts: meta._ts,
        onVote: function (vote) {
          mutateState((st) => {
            const m = st.msgs.find((x) => x.id === id);
            if (m) m.vote = vote;
          }, false);
        },
      });
      const row = el("div", { className: "skai-msg-row" });
      const avatar = el("div", { className: "skai-msg-avatar", innerHTML: bunnyImg(30) });
      const col = el("div", { className: "skai-msg-col" });
      const line = el("div", { className: "skai-line" });
      const bubble = el("div", { className: "skai-bubble" });
      line.appendChild(avatar);
      line.appendChild(bubble);
      col.appendChild(line);

      // Усе, що з'являється ПІСЛЯ тексту: кнопки оператора, мета, картки, чипи уточнення
      const later = [];
      const actionKind = resolveOperatorActionKind(text, meta.userMessage);
      if (actionKind) later.push(buildOperatorActions(actionKind));
      later.push(buildBotMeta(text, meta));
      if (cards && cards.length) later.push(buildCards(cards));
      if (filters && ((filters.brands && filters.brands.length) || (filters.priceRanges && filters.priceRanges.length) || (filters.options && filters.options.length))) {
        later.push(buildFilterChips(filters));
      }
      if (meta.quickReplies && meta.quickReplies.length) later.push(buildQuickReplies(meta.quickReplies));
      later.forEach((n) => col.appendChild(n));
      row.appendChild(col);
      body.appendChild(row);

      // Відновлення історії — миттєво, без анімації
      const animate = !!meta.animate && !meta.transient && !restoring && !REDUCE_MOTION;
      if (!animate) {
        bubble.textContent = text;
        scrollDown();
        return;
      }

      finishActiveTyping();
      row.classList.add("skai-enter");
      pinTop(row);
      // Скриваємо картки і блоки ДО друку, інакше вони видні до появи. Контейнер не ховаємо —
      // ховаються саме елементи, які потім з'являться при прокрутці.
      const reveal = collectReveal(later);
      reveal.forEach((n) => n.classList.add("skai-pending"));
      typeText(bubble, text).then(() => revealOnView(reveal));
    }

    const STORES_URL = "https://skay.ua/uk/stores/";
    const OPERATOR_TG_URL = "https://t.me/Skayua_bot";
    const OPERATOR_PHONE = "+38 (093) 993-91-18";
    const OPERATOR_PHONE_HREF = "tel:+380939939118";
    // МайстерСКАЯ (сервісний центр/ремонт) — окремий бот і телефон від звичайного продажного оператора.
    const SERVICE_TG_URL = "https://t.me/Master_skayua_bot";
    const SERVICE_PHONE = "(073) 225-25-05";
    const SERVICE_PHONE_HREF = "tel:+380732252505";
    const STORES = [
      { addr: "пров. Футуристів (Маяковського), 1", phone: "(048) 705-47-64" },
      { addr: "вул. Корольова, 70", phone: "(048) 705-45-27" },
      { addr: "вул. Одарія, 3", phone: "(048) 705-37-04" },
      { addr: "вул. Академіка Сахарова, 3К", phone: "(048) 705-37-07" },
    ];
    const MASTERSKAYA = [
      { addr: "вул. Одарія, 2/3", phone: "(048) 705-47-65", hours: "9:00–18:00", map: "https://maps.app.goo.gl/rsHYoqGmN7p1fRyA9" },
      { addr: "пров. Футуристів (Маяковського), 1", phone: "(073) 225-25-05", hours: "10:00–20:00", map: "https://maps.app.goo.gl/tyTNt85UmWXYmreM7" },
    ];

    function telHref(phone) {
      return "tel:+38" + phone.replace(/\D/g, "");
    }

    function storeItem(st, hours) {
      const map = st.map || "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent("Одеса, " + st.addr);
      const item = el("div", { className: "skai-store" });
      item.appendChild(el("a", { className: "skai-store-addr", href: map, target: "_blank", rel: "noopener", textContent: st.addr }));
      const line = el("div", { className: "skai-store-line" });
      line.appendChild(el("a", { href: telHref(st.phone), textContent: st.phone }));
      line.appendChild(document.createTextNode(" · " + (st.hours || hours)));
      item.appendChild(line);
      return item;
    }

    // Статична відповідь про магазини: без запиту до сервера/Gemini, токени не витрачаються.
    function addStoresBubble() {
      const bubble = el("div", { className: "skai-bubble skai-stores" });
      bubble.appendChild(el("div", { className: "skai-stores-title", textContent: "Наші магазини в Одесі 📍" }));
      bubble.appendChild(el("div", { className: "skai-stores-note", textContent: "Можна подивитися товар наживо, отримати консультацію й забрати замовлення за ціною сайту." }));
      bubble.appendChild(el("div", { className: "skai-stores-label", textContent: "Магазини · щодня 10:00–20:00" }));
      STORES.forEach((st) => bubble.appendChild(storeItem(st, "10:00–20:00")));
      bubble.appendChild(el("div", { className: "skai-stores-label", textContent: "МайстерСКАЯ" }));
      MASTERSKAYA.forEach((st) => bubble.appendChild(storeItem(st)));
      bubble.appendChild(el("a", { className: "skai-stores-all", href: STORES_URL, target: "_blank", rel: "noopener", textContent: "Усі магазини на сайті →" }));

      const row = el("div", { className: "skai-msg-row" });
      const col = el("div", { className: "skai-msg-col" });
      const line = el("div", { className: "skai-line" });
      line.appendChild(el("div", { className: "skai-msg-avatar", innerHTML: bunnyImg(30) }));
      line.appendChild(bubble);
      col.appendChild(line);
      col.appendChild(buildBotMeta("Наші магазини (статична відповідь)", { userMessage: "Наші магазини" }));
      row.appendChild(col);
      body.appendChild(row);
      return row;
    }

    function showStores() {
      ensureSession();
      addUserBubble("Наші магазини");
      const row = addStoresBubble();
      record({ k: "s", ts: Date.now() });
      // довге повідомлення: показуємо його з початку, а не з кінця
      const top = body.scrollTop + row.getBoundingClientRect().top - body.getBoundingClientRect().top - 12;
      body.scrollTo({ top, behavior: "smooth" });
    }

    function buildBotMeta(replyText, meta) {
      const wrap = el("div", { className: "skai-metarow" });
      wrap.appendChild(el("span", { className: "skai-meta", textContent: `Skay · ${nowLabel(meta && meta._ts)}` }));
      const votes = el("div", { className: "skai-votes" });
      let voted = null;
      const up = el("button", { className: "skai-vote", innerHTML: thumbSVG(), title: "Гарна відповідь" });
      const down = el("button", { className: "skai-vote skai-vote-down", innerHTML: thumbSVG(), title: "Погана відповідь" });
      function sendFeedback(vote) {
        if (voted) return;  
        voted = vote;
        up.classList.toggle("active", vote === "up");
        down.classList.toggle("active", vote === "down");
        votes.classList.add("skai-voted");
        fetch(API_FEEDBACK, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: getSessionId(),
            vote,
            botReply: replyText,
            userMessage: meta && meta.userMessage,
          }),
        }).catch(() => {});
        if (meta && meta.onVote) meta.onVote(vote);
      }
      if (meta && meta._vote) {
        // оцінка вже була поставлена до переходу на іншу сторінку
        voted = meta._vote;
        up.classList.toggle("active", voted === "up");
        down.classList.toggle("active", voted === "down");
        votes.classList.add("skai-voted");
      }
      up.addEventListener("click", () => sendFeedback("up"));
      down.addEventListener("click", () => sendFeedback("down"));
      votes.appendChild(up);
      votes.appendChild(down);
      wrap.appendChild(votes);
      return wrap;
    }

    function buildFilterChips(filters) {
       
       
       
      function withBudget(q) {
        if (filters.budgetMin && filters.budgetMax) return `${q} від ${filters.budgetMin} до ${filters.budgetMax} грн`;
        if (filters.budgetMin) return `${q} від ${filters.budgetMin} грн`;
        if (filters.budgetMax) return `${q} до ${filters.budgetMax} грн`;
        return q;
      }
       
       
       
      function withCondition(q) {
        if (filters.condition === "used") return `б/у ${q}`.trim();
        if (filters.condition === "new") return `новий ${q}`.trim();
        return q;
      }
      const wrap = el("div", { className: "skai-filterchips" });
      // Послідовні перемикачі одного товару (для iPhone: пам'ять і тип SIM).
      // Це не загальні фільтри каталогу: кожна кнопка надсилає вже повний точний запит.
      if (filters.groups && filters.groups.length) {
        filters.groups.forEach((group) => {
          if (!group.options || !group.options.length) return;
          wrap.appendChild(el("div", { className: "skai-filterchips-label", textContent: group.label }));
          const row = el("div", { className: "skai-filterchips-row" });
          group.options.forEach((opt) => {
            const btn = el("button", { className: "skai-filterchip", textContent: opt.label });
            btn.addEventListener("click", () => send(opt.q || opt.text || opt.label));
            row.appendChild(btn);
          });
          wrap.appendChild(row);
        });
      }
      if (filters.options && filters.options.length) {
        // готові варіанти уточнення з сервера (напр. серії Funko POP!): клік надсилає готовий запит q
        wrap.appendChild(el("div", { className: "skai-filterchips-label", textContent: filters.optionsLabel || "Оберіть серію:" }));
        const goBack = filters.options.filter((o) => o.kind === "back");
        const regular = filters.options.filter((o) => o.kind !== "back");
        const hasCounts = regular.some((o) => typeof o.count === "number");
        const onPick = (opt) => send(opt.q, opt.key ? { categoryKey: opt.key, categoryMode: opt.mode || "browse" } : null);
        if (hasCounts) {
          // розділи каталогу: сітка кнопок «назва — кількість»; непарна остання кнопка розтягується на весь рядок
          const grid = el("div", { className: "skai-optgrid" });
          regular.forEach((opt, i) => {
            const btn = el("button", { className: "skai-opt" + (opt.kind === "direct" ? " skai-opt-direct" : "") });
            if (regular.length % 2 === 1 && i === regular.length - 1) btn.classList.add("skai-opt-wide");
            btn.appendChild(el("span", { className: "skai-opt-name", textContent: opt.name || opt.label }));
            if (typeof opt.count === "number") btn.appendChild(el("span", { className: "skai-opt-count", textContent: String(opt.count) }));
            btn.addEventListener("click", () => onPick(opt));
            grid.appendChild(btn);
          });
          wrap.appendChild(grid);
        } else {
          // готові варіанти без лічильників (серії Funko POP! тощо): компактні кнопки-таблетки
          const optRow = el("div", { className: "skai-filterchips-row" });
          regular.forEach((opt) => {
            const btn = el("button", { className: "skai-filterchip", textContent: opt.label });
            btn.addEventListener("click", () => onPick(opt));
            optRow.appendChild(btn);
          });
          wrap.appendChild(optRow);
        }
        goBack.forEach((opt) => {
          const btn = el("button", { className: "skai-opt-back", textContent: opt.label });
          btn.addEventListener("click", () => onPick(opt));
          wrap.appendChild(btn);
        });
      }
      if (filters.brands && filters.brands.length) {
        wrap.appendChild(el("div", { className: "skai-filterchips-label", textContent: "Уточнити бренд:" }));
        const row = el("div", { className: "skai-filterchips-row" });
        filters.brands.slice(0, 8).forEach((brand) => {
          const btn = el("button", { className: "skai-filterchip", textContent: brand });
          btn.addEventListener("click", () => {
             
             
             
            let q = filters.category ? `${filters.category} ${brand}` : brand;
            send(withCondition(withBudget(q)), filters.nodeKey ? { categoryKey: filters.nodeKey } : null);
          });
          row.appendChild(btn);
        });
        wrap.appendChild(row);
      }
      if (filters.priceRanges && filters.priceRanges.length) {
        wrap.appendChild(el("div", { className: "skai-filterchips-label", textContent: "Уточнити ціну:" }));
        const priceRow = el("div", { className: "skai-filterchips-row" });
        filters.priceRanges.forEach((range) => {
          const btn = el("button", { className: "skai-filterchip", textContent: range.label });
          btn.addEventListener("click", () => {
             
             
            let q = [filters.category, filters.brand].filter(Boolean).join(" ");
            if (range.min && range.max) q += ` від ${range.min} до ${range.max} грн`;
            else if (range.max) q += ` до ${range.max} грн`;
            else if (range.min) q += ` від ${range.min} грн`;
            send(withCondition(q.trim()), filters.nodeKey ? { categoryKey: filters.nodeKey } : null);
          });
          priceRow.appendChild(btn);
        });
        wrap.appendChild(priceRow);
      }
      return wrap;
    }

    // Кнопки-підказки під відповіддю (наприклад, «Оцінити мій старий iPhone у трейд-ін»).
    // Натискання відправляє текст як звичайне повідомлення; після вибору кнопки блокуються.
    function buildQuickReplies(list) {
      const wrap = el("div", { className: "skai-replies" });
      list.forEach((q) => {
        const b = el("button", { className: "skai-quick-btn", type: "button", textContent: q.label });
        b.addEventListener("click", () => {
          wrap.querySelectorAll("button").forEach((x) => (x.disabled = true));
          send(q.text || q.label);
        });
        wrap.appendChild(b);
      });
      return wrap;
    }

    function buildCards(cards) {
       
       
       
       
       
      const wrap = el("div", { className: "skai-cards" });
      const VISIBLE_DEFAULT = 5;
      const list = cards.slice(0, 24);

      function renderCard(c) {
        const isMobileView = window.matchMedia && window.matchMedia("(max-width: 480px)").matches;
        const a = el("a", {
          className: "skai-card",
          href: c.url || "#",
          target: isMobileView ? "_self" : "_blank",
          rel: "noopener",
        });
        // Перехід на сторінку товару: віджет закривається і запам'ятовує, що він закритий,
        // тож на сторінці товару він не висітиме відкритим (state зберігається в localStorage,
        // який спільний для сторінок skay.ua).
        a.addEventListener("click", function () {
          if (typeof window.__skaiClose === "function") window.__skaiClose();
        });
        const img = el("img", { src: c.picture || "", alt: "", onerror: function () { this.style.visibility = "hidden"; } });
        const info = el("div", { className: "skai-card-info" });
        info.appendChild(el("div", { className: "skai-card-name", textContent: c.name }));
        const meta = el("div", { className: "skai-card-meta" });
        meta.appendChild(
          el("span", {
            className: "skai-card-price",
            textContent: c.price ? `${c.price} грн` : "ціна за запитом",
          })
        );
        if (c.oldPrice) {
          meta.appendChild(el("span", { className: "skai-card-oldprice", textContent: `${c.oldPrice} грн` }));
        }
        if (c.discountPct) {
          meta.appendChild(el("span", { className: "skai-card-discount", textContent: `-${c.discountPct}%` }));
        }
        if (c.tag) {
          const tagEl = el("span", { className: "skai-card-tag", textContent: c.tag });
          if (/замін|схож/i.test(c.tag)) tagEl.classList.add("skai-tag-alt");
          meta.appendChild(tagEl);
        }
        if (!c.available) meta.appendChild(el("span", { className: "skai-card-unavail", textContent: "немає в наявності" }));
        info.appendChild(meta);
        a.appendChild(img);
        a.appendChild(info);
        return a;
      }

      list.slice(0, VISIBLE_DEFAULT).forEach((c) => wrap.appendChild(renderCard(c)));

      if (list.length > VISIBLE_DEFAULT) {
        const rest = list.slice(VISIBLE_DEFAULT);
        const moreBtn = el("button", {
          className: "skai-showmore",
          textContent: `Показати ще ${rest.length}`,
        });
        moreBtn.addEventListener("click", () => {
          rest.forEach((c) => wrap.insertBefore(renderCard(c), moreBtn));
          moreBtn.remove();
        });
        wrap.appendChild(moreBtn);
      }

      return wrap;
    }

    const TYPING_PHRASES = [
      "Опрацьовую ваш запит…",
      "Підбираю найкраще для вас…",
      "Гортаю каталог…",
      "Ще хвильку…",
    ];

    function addTyping() {
      const row = el("div", { className: "skai-msg-row", id: "skai-typing-row" });
      row.appendChild(el("div", { className: "skai-msg-avatar", innerHTML: bunnyImg(30) }));
      const bubble = el("div", { className: "skai-bubble skai-typing-bubble" });
      const label = el("span", { className: "skai-typing-label", textContent: TYPING_PHRASES[0] });
      bubble.appendChild(label);
      bubble.appendChild(el("div", { className: "skai-typing" }, [el("span"), el("span"), el("span")]));
      row.appendChild(bubble);
      body.appendChild(row);
      scrollDown();

       
       
      let i = 0;
      const timer = setInterval(() => {
        i = (i + 1) % TYPING_PHRASES.length;
        if (label.isConnected) label.textContent = TYPING_PHRASES[i];
        else clearInterval(timer);
      }, 1600);
      row.dataset.timerId = String(timer);
    }
    function removeTyping() {
      const r = body.querySelector("#skai-typing-row");
      if (r) {
        if (r.dataset.timerId) clearInterval(Number(r.dataset.timerId));
        r.remove();
      }
    }

    async function send(text, extra) {
      const trimmed = (text || "").trim();
      if (!trimmed) return;
      finishActiveTyping();
      ensureSession();
      addUserBubble(trimmed);
      input.value = "";
      sendBtn.disabled = true;
      addTyping();
      try {
        const res = await fetch(API_CHAT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(Object.assign({ message: trimmed, sessionId: getSessionId() }, extra || {})),
        });
        const data = await res.json();
        removeTyping();
        if (!res.ok) {
          addBotBubble(data.error || "Сталася помилка. Спробуйте ще раз.", null, null, { transient: true });
        } else {
          addBotBubble(data.reply, data.products, data.filters, { userMessage: trimmed, animate: true, quickReplies: data.quickReplies });
        }
      } catch (e) {
        removeTyping();
        addBotBubble("Не вдалося зʼєднатись із сервером. Перевірте інтернет і спробуйте ще раз.", null, null, { transient: true });
      } finally {
        sendBtn.disabled = false;
      }
    }

    // Якщо сесія закінчилась, поки сторінка була відкрита (або її скинули в іншій вкладці) —
    // очищаємо вікно й починаємо з привітання, щоб екран збігався з памʼяттю сервера.
    function ensureSession() {
      const st = getState();
      if (st.sid === activeSid) return;
      activeSid = st.sid;
      body.innerHTML = "";
      greet();
      body.dataset.greeted = "1";
    }

    // Відтворюємо історію поточної сесії після переходу на іншу сторінку.
    function restoreSession() {
      const st = getState();
      if (st.msgs.length) {
        restoring = true;
        try {
          st.msgs.forEach((m) => {
            if (m.k === "u") addUserBubble(m.text, m.ts);
            else if (m.k === "b") addBotBubble(m.text, m.cards, m.filters, { userMessage: m.um, _id: m.id, _ts: m.ts, _vote: m.vote });
            else if (m.k === "s") addStoresBubble();
          });
        } finally {
          restoring = false;
        }
        body.dataset.greeted = "1";
      }
      if (st.open) {
        toggle(true);
        scrollDown();
      }
    }
    restoreSession();

    sendBtn.addEventListener("click", () => send(input.value));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") send(input.value);
    });
    // Передаємо повну (до 40 останніх повідомлень) історію чату менеджерам у Telegram.
    // Робимо це "тихо" у фоні — кнопка й далі одразу шле повідомлення в сам чат (send()),
    // це лише додатково сповіщає живого оператора, не змінюючи видиму поведінку кнопки.
    function notifyOperator() {
      try {
        const st = getState();
        const messages = st.msgs
          .map((m) => {
            if (m.k === "u") return { role: "user", text: m.text };
            if (m.k === "b") return { role: "bot", text: m.text };
            return null;
          })
          .filter(Boolean);
        fetch(API_HANDOFF, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: getSessionId(), pageUrl: location.href, messages }),
        }).catch(() => {});
      } catch (e) {}
    }

    quick.addEventListener("click", (e) => {
      const stores = e.target.closest("button[data-action='stores']");
      if (stores) { showStores(); return; }
      const btn = e.target.closest("button[data-q]");
      if (!btn) return;
      const q = btn.getAttribute("data-q");
      if (q === "Зʼєднай мене з оператором") notifyOperator();
      send(q);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", buildWidget);
  } else {
    buildWidget();
  }
})();
