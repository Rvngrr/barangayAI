// ── MESSAGE ACTIONS AND VERSIONS ──────────────────────────────────────
// Copy / Edit on a prompt, Copy / Ask again on an answer, and a `‹ 2/3 ›`
// switcher wherever a turn has more than one version.
//
// Editing a prompt or asking again keeps what was there. Nothing is discarded,
// so a student can put two wordings of the same question side by side — or two
// answers to the same question — and read the difference in the traces.
//
// ── The shape ─────────────────────────────────────────────────────────
// The conversation stays the flat `session.displayMessages` array it has always
// been. That array is the ACTIVE PATH through the versions, and it remains the
// only thing renderSessionMessages(), rebuildApiMessages(), and the sidebar
// badge ever read — none of them had to learn about versions.
//
// Alternatives hang off the user message that anchors the turn:
//
//   m.versions = [                        ← Edit adds one; arrows on the prompt
//     { content, time,
//       answers: [ { tail: [...] } ],     ← Ask again adds one; arrows on the answer
//       answerActive: 0 },
//   ]
//   m.active = 0
//
// `tail` is every message that followed, and it is only ever populated for an
// INACTIVE version. The active version's tail *is* the live slice of
// displayMessages after the anchor, so no message is ever stored twice and the
// two can't drift apart. Switching versions parks the live slice on the version
// being left and splices in the one being entered.
//
// Nesting falls out for free: a parked tail can itself hold user messages with
// their own versions.
//
// The anchor is always addressed by object identity, never by position. Several
// paths in sendMessage() pop a user turn out of displayMessages while its bubble
// stays on screen ("No response received"), so counting rows in the DOM would
// eventually act on the wrong turn.

const ICON_ACT_COPY  = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const ICON_ACT_CHECK = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
const ICON_ACT_EDIT  = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4Z"/></svg>';
const ICON_ACT_RETRY = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>';
const ICON_VER_PREV  = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';
const ICON_VER_NEXT  = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>';

function copyPlainText(text, done) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  } else fallbackCopy(text, done);
}

function msgActionBtn(label, icon, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'msg-action';
  b.title = label;
  b.setAttribute('aria-label', label);
  b.innerHTML = icon;
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(b); });
  return b;
}

function flashCopied(btn) {
  btn.classList.add('copied');
  btn.innerHTML = ICON_ACT_CHECK;
  setTimeout(() => {
    if (!btn.isConnected) return;
    btn.classList.remove('copied');
    btn.innerHTML = ICON_ACT_COPY;
  }, 1400);
}

// ── VERSION BOOKKEEPING ───────────────────────────────────────────────

// The slot the live tail currently belongs to: the active answer of the active
// version. Returns null for a message that has no versions yet.
function activeSlot(m) {
  if (!m || !m.versions) return null;
  const v = m.versions[m.active];
  return v ? v.answers[v.answerActive] : null;
}

// Move everything after the anchor out of the live path and onto `slot`. The
// messages are kept whole in memory — including their prompt snapshots, so two
// versions can be compared inspector to inspector within a session. It is only
// on the way to storage that the snapshots are dropped (see _versionsForStorage
// in db.js), which is the same rule an ordinary older answer already lives by.
function parkTail(session, idx, slot) {
  const tail = session.displayMessages.splice(idx + 1);
  if (slot) slot.tail = tail;
}

// Put a parked tail back on the live path, leaving the slot empty so the only
// copy of those messages is the live one.
function restoreTail(session, slot) {
  if (!slot || !slot.tail || !slot.tail.length) return;
  session.displayMessages.push(...slot.tail);
  slot.tail = [];
}

// First call turns an ordinary turn into a one-version turn, recording what is
// already there as version 1 so the new alternative sits beside it rather than
// replacing it.
function ensureVersions(m) {
  if (m.versions) return;
  m.versions = [{ content: m.content, time: m.time, answers: [{ tail: [] }], answerActive: 0 }];
  m.active = 0;
}

// How many prompt versions this turn has, and which one is showing.
function promptCount(m) { return m && m.versions ? m.versions.length : 1; }
function answerCount(m) {
  const v = m && m.versions ? m.versions[m.active] : null;
  return v ? v.answers.length : 1;
}

// ── THE ACTION ROW ────────────────────────────────────────────────────

// `timeEl` is the `.message-time` row that already sits under the bubble. It is
// centred on the same 720px column and carries the same 42px indent, so the
// actions need no layout of their own.
//
// `anchor` on an answer is the user message that asked for it — the answer's own
// Ask again and `‹ 2/3 ›` both act on that turn, even though they are shown here.
function attachMsgActions(timeEl, opts) {
  if (!timeEl) return;
  const { role, text, msgObj, anchor, noAnswer } = opts || {};

  const wrap = document.createElement('span');
  wrap.className = 'msg-actions';

  if (role === 'user') {
    if (promptCount(msgObj) > 1) {
      wrap.appendChild(versionSwitcher(msgObj, 'prompt'));
    }
    if (text) {
      wrap.appendChild(msgActionBtn('Copy', ICON_ACT_COPY,
        (b) => copyPlainText(text, () => flashCopied(b))));
      wrap.appendChild(msgActionBtn('Edit and send again', ICON_ACT_EDIT,
        () => beginPromptEdit(timeEl, msgObj, text)));
      // Normally Ask again lives on the answer. A prompt with no answer under it
      // has nowhere else to put it, and that is exactly when it is needed.
      if (noAnswer) {
        wrap.appendChild(msgActionBtn('Ask again', ICON_ACT_RETRY, () => askAgain(msgObj)));
      }
    }
    if (!wrap.children.length) return;
    // The user's row is right-aligned, so the actions go before the timestamp —
    // that keeps the time itself at the edge the bubble above it ends on.
    timeEl.insertBefore(wrap, timeEl.firstChild);
  } else {
    if (text) {
      wrap.appendChild(msgActionBtn('Copy', ICON_ACT_COPY,
        (b) => copyPlainText(text, () => flashCopied(b))));
    }
    if (anchor) {
      wrap.appendChild(msgActionBtn('Ask again', ICON_ACT_RETRY,
        () => askAgain(anchor)));
      if (answerCount(anchor) > 1) wrap.appendChild(versionSwitcher(anchor, 'answer'));
    }
    if (!wrap.children.length) return;
    timeEl.appendChild(wrap);
  }
}

// `‹ 2/3 ›`. One switcher for prompt versions (shown on the prompt) and one for
// answer versions of the showing prompt (shown on the answer).
function versionSwitcher(anchor, kind) {
  const total = kind === 'prompt' ? promptCount(anchor) : answerCount(anchor);
  const at = kind === 'prompt'
    ? anchor.active
    : anchor.versions[anchor.active].answerActive;

  const wrap = document.createElement('span');
  wrap.className = 'msg-versions';
  wrap.title = kind === 'prompt'
    ? `Version ${at + 1} of ${total} of this message`
    : `Answer ${at + 1} of ${total} to this message`;

  const step = (delta) => {
    const next = at + delta;
    if (next < 0 || next >= total) return;
    switchVersion(anchor, kind, next);
  };
  const prev = msgActionBtn('Previous', ICON_VER_PREV, () => step(-1));
  const next = msgActionBtn('Next', ICON_VER_NEXT, () => step(1));
  prev.classList.add('msg-version-step');
  next.classList.add('msg-version-step');
  prev.disabled = at === 0;
  next.disabled = at === total - 1;

  const label = document.createElement('span');
  label.className = 'msg-version-count';
  label.textContent = `${at + 1}/${total}`;

  wrap.appendChild(prev);
  wrap.appendChild(label);
  wrap.appendChild(next);
  return wrap;
}

// ── EDIT A PROMPT IN PLACE ────────────────────────────────────────────
// Editing is pure DOM until it is submitted. Nothing is moved while the editor
// is open, so backing out costs nothing.
let _promptEdit = null;

function cancelPromptEdit() {
  const open = _promptEdit;
  _promptEdit = null;
  if (!open) return;
  if (open.editor && open.editor.parentNode) open.editor.parentNode.removeChild(open.editor);
  if (open.bubble && open.bubble.isConnected) open.bubble.style.display = '';
}

function beginPromptEdit(timeEl, msgObj, text) {
  if (isStreaming) return;
  cancelPromptEdit();   // one editor at a time
  // Every path that builds a message appends the timestamp directly after the
  // row, so the row is the timestamp's previous sibling.
  const row = timeEl.previousElementSibling;
  const bubble = row && row.querySelector('.bubble.user');
  if (!bubble) return;

  const editor = document.createElement('div');
  editor.className = 'prompt-edit';
  const ta = document.createElement('textarea');
  ta.className = 'prompt-edit-input';
  ta.rows = 1;
  ta.value = text;

  const bar = document.createElement('div');
  bar.className = 'prompt-edit-bar';
  const hint = document.createElement('span');
  hint.className = 'prompt-edit-hint';
  hint.textContent = 'Sends as a new version';
  bar.appendChild(hint);

  const commit = () => {
    const next = ta.value.trim();
    cancelPromptEdit();
    if (!next) return;   // emptied out — treat as backing out
    editPrompt(msgObj, next);
  };

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'prompt-edit-btn';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', cancelPromptEdit);
  const sendBtn = document.createElement('button');
  sendBtn.type = 'button';
  sendBtn.className = 'prompt-edit-btn primary';
  sendBtn.textContent = 'Send';
  sendBtn.addEventListener('click', commit);
  bar.appendChild(cancelBtn);
  bar.appendChild(sendBtn);

  editor.appendChild(ta);
  editor.appendChild(bar);
  bubble.style.display = 'none';
  row.appendChild(editor);
  _promptEdit = { row, bubble, editor };

  const grow = () => {
    ta.style.height = '0px';
    ta.style.height = Math.min(ta.scrollHeight, 260) + 'px';
  };
  ta.addEventListener('input', grow);
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); cancelPromptEdit(); }
    else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
  });
  grow();
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
  autoScroll();
}

// ── THE THREE OPERATIONS ──────────────────────────────────────────────

// A conversation named after its first prompt should follow that prompt when it
// changes — but a title the student typed themselves is theirs to keep. Clearing
// it back to the placeholder is enough for a send: updateHistory() re-derives it
// at the end. A version switch has no send, so it sets the title outright.
// autoTitleFrom / isAutoTitle live next to updateHistory in app/chat.js, so the
// rule for deriving a title and the rule for recognising one can't drift.
function retitleFor(session, idx, oldText, newText) {
  if (idx !== 0) return;
  if (!isAutoTitle(session.title, oldText || '')) return;
  session.title = newText === null ? 'New conversation' : autoTitleFrom(newText);
}

// Common preamble: locate the anchor, refuse if the turn is no longer on the
// path, and check a model is selected BEFORE anything is moved.
function anchorFor(msgObj, textForComposer) {
  if (isStreaming) return null;
  const session = getCurrentSession();
  if (!session) return null;
  const idx = session.displayMessages.indexOf(msgObj);
  if (idx < 0) {
    // sendMessage() drops a user turn whose answer came back empty, while its
    // bubble stays on screen. There is no turn here to version, so hand the text
    // to the composer and let the student send it themselves.
    const input = document.getElementById('message-input');
    if (input && textForComposer) { input.value = textForComposer; syncComposer(); input.focus(); }
    return null;
  }
  return { session, idx };
}

// Edit: a new version of the prompt, with its own answers.
function editPrompt(msgObj, text) {
  const at = anchorFor(msgObj, text);
  if (!at || !ensureModelSelected()) return;
  const { session, idx } = at;

  ensureVersions(msgObj);
  parkTail(session, idx, activeSlot(msgObj));
  msgObj.versions.push({ content: text, time: getTime(), answers: [{ tail: [] }], answerActive: 0 });
  msgObj.active = msgObj.versions.length - 1;
  retitleFor(session, idx, msgObj.content, null);
  msgObj.content = text;
  msgObj.time = msgObj.versions[msgObj.active].time;

  commitAndSend(session, msgObj, text);
}

// Ask again: another answer to the prompt as it stands.
function askAgain(msgObj) {
  const at = anchorFor(msgObj, msgObj && msgObj.content);
  if (!at || !ensureModelSelected()) return;
  const { session, idx } = at;

  ensureVersions(msgObj);
  parkTail(session, idx, activeSlot(msgObj));
  const v = msgObj.versions[msgObj.active];
  v.answers.push({ tail: [] });
  v.answerActive = v.answers.length - 1;

  commitAndSend(session, msgObj, msgObj.content);
}

// Shared tail of both: the anchor is on the path with nothing after it, so
// rebuild the model's context up to and including it, repaint, and send.
function commitAndSend(session, anchor, text) {
  // The stored rows for this session no longer line up with memory positionally
  // — the anchor's own content and versions changed. db.js rebuilds the session
  // when it sees this rather than appending.
  session._rewrite = true;
  messages = rebuildApiMessages(session.displayMessages);
  saveSessionsToStorage();
  repaintThread(session);

  const input = document.getElementById('message-input');
  if (input) { input.value = text; syncComposer(); }
  // The anchor is already on the path and already in `messages`, so the send
  // must not append a second copy of the prompt.
  sendMessage(anchor);
}

// Switch which version is showing. No send: the answers are already there.
function switchVersion(msgObj, kind, next) {
  const at = anchorFor(msgObj, null);
  if (!at) return;
  const { session, idx } = at;
  if (!msgObj.versions) return;

  parkTail(session, idx, activeSlot(msgObj));

  if (kind === 'prompt') {
    const v = msgObj.versions[next];
    if (!v) return;
    retitleFor(session, idx, msgObj.content, v.content);
    msgObj.active = next;
    msgObj.content = v.content;
    msgObj.time = v.time;
  } else {
    const v = msgObj.versions[msgObj.active];
    if (!v || !v.answers[next]) return;
    v.answerActive = next;
  }

  restoreTail(session, activeSlot(msgObj));
  session._rewrite = true;
  messages = rebuildApiMessages(session.displayMessages);
  saveSessionsToStorage();
  repaintThread(session);
  scrollToBottom();
}

// Repaint the conversation from the active path. renderSessionMessages() is the
// same path a reopened session takes, so a switched thread is identical to a
// reloaded one. An emptied thread is left blank rather than shown the welcome
// screen, which would reopen the sidebar only for the send to collapse it again
// a frame later.
function repaintThread(session) {
  cancelPromptEdit();
  if (session.displayMessages.length) {
    renderSessionMessages(session);
  } else {
    const chatArea = document.getElementById('chat-area');
    if (chatArea) chatArea.innerHTML = '';
    const titleEl = document.getElementById('chat-title');
    if (titleEl) titleEl.textContent = session.title;
  }
  renderHistory();   // the sidebar badge counts the active path
}

// Called at the top of sendMessage(): an open editor belongs to the state the
// send is about to move on from.
function noteSendStarted() {
  cancelPromptEdit();
}
