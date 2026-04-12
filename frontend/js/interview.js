/**
 * interview.js – Main frontend logic for the Mock Interview AI platform.
 *
 * Depends on: SpeechService (speech.js loaded first)
 */

// ─────────────────────────────────────────────────────────────────────────────
// Constants & state
// ─────────────────────────────────────────────────────────────────────────────

const API_BASE = '';   // same origin; Flask serves everything

let sessionId        = null;
let currentQuestion  = null;   // full question object from server
let currentIsFollowUp = false; // true when currently displayed question is a follow-up
let questionNum      = 1;
let totalQuestions   = 0;
let isRecording      = false;
let isSubmitting     = false;

// ─────────────────────────────────────────────────────────────────────────────
// DOM refs (resolved after DOMContentLoaded)
// ─────────────────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

let DOM = {};

// ─────────────────────────────────────────────────────────────────────────────
// Utility helpers
// ─────────────────────────────────────────────────────────────────────────────

function showScreen(name) {
  ['start-screen', 'interview-screen', 'end-screen'].forEach(id => {
    $(id).classList.toggle('hidden', id !== name);
  });
}

function setLoading(visible, text = 'Please wait…') {
  $('loading-overlay').classList.toggle('hidden', !visible);
  $('loading-text').textContent = text;
}

function showToast(msg, type = 'error') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  $('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

function scoreToColorClass(s) {
  if (s >= 80) return 'score-good';
  if (s >= 60) return 'score-medium';
  return 'score-poor';
}

function typeBadgeClass(type) {
  const map = {
    technical: 'badge-technical',
    behavioral: 'badge-behavioral',
    case_study: 'badge-case_study',
    follow_up:  'badge-follow_up',
    general:    'badge-general',
  };
  return map[type] || 'badge-general';
}

// ─────────────────────────────────────────────────────────────────────────────
// Roles
// ─────────────────────────────────────────────────────────────────────────────

async function loadRoles() {
  try {
    const res  = await fetch(`${API_BASE}/api/roles`);
    const data = await res.json();
    const sel  = $('role-select');
    sel.innerHTML = '<option value="" disabled selected>Choose a role…</option>';
    (data.roles || []).forEach(role => {
      const opt = document.createElement('option');
      opt.value       = role;
      opt.textContent = role;
      sel.appendChild(opt);
    });
  } catch (err) {
    showToast('Could not load roles from server. Is the backend running?');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Interview start
// ─────────────────────────────────────────────────────────────────────────────

async function startInterview() {
  const role   = $('role-select').value;
  const skills = $('skills-input').value.trim();

  if (!role) { showToast('Please select a role.'); return; }
  if (!skills) { showToast('Please enter at least one skill.'); return; }

  setLoading(true, '🤖 Generating your personalised interview…');
  $('start-btn').disabled = true;

  try {
    const res = await fetch(`${API_BASE}/api/start_interview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, skills }),
    });

    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Failed to start interview.');
      return;
    }

    sessionId       = data.session_id;
    totalQuestions  = data.progress?.total || 9;
    questionNum     = 1;

    setLoading(false);
    showScreen('interview-screen');
    displayQuestion(data.question, data.progress);

  } catch (err) {
    showToast('Network error. Make sure the backend is running.');
    console.error(err);
  } finally {
    setLoading(false);
    $('start-btn').disabled = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Question display
// ─────────────────────────────────────────────────────────────────────────────

function displayQuestion(question, progress) {
  currentQuestion   = question;
  currentIsFollowUp = (question.type === 'follow_up');

  // Progress
  if (progress) {
    totalQuestions = progress.total;
    const pct = ((progress.current - 1) / progress.total) * 100;
    $('progress-fill').style.width = `${pct}%`;
    $('progress-label').textContent = `Question ${progress.current} / ${progress.total}`;
    $('question-number').textContent = `#${String(progress.current).padStart(2, '0')}`;
  }

  // Type badge
  const typeBadgeEl = $('q-type-badge');
  typeBadgeEl.textContent = (question.type || 'general').replace('_', ' ');
  typeBadgeEl.className = `q-type-badge ${typeBadgeClass(question.type)}`;

  // Question text (animated)
  const qtEl = $('question-text');
  qtEl.style.opacity = 0;
  setTimeout(() => {
    qtEl.textContent = question.question || 'No question text.';
    qtEl.style.transition = 'opacity 0.4s';
    qtEl.style.opacity = 1;
  }, 150);

  // Keywords (hidden by default)
  const kwRow = $('keywords-row');
  kwRow.innerHTML = '';
  if (question.expected_keywords?.length) {
    question.expected_keywords.forEach(kw => {
      const span = document.createElement('span');
      span.className   = 'keyword-pill';
      span.textContent = kw;
      kwRow.appendChild(span);
    });
    // Keep keywords hidden until answer is submitted
    kwRow.classList.add('hidden');
  }

  // Reset controls
  resetAnswerState();
  $('eval-card').classList.add('hidden');
}

function revealKeywords() {
  $('keywords-row').classList.remove('hidden');
}

// ─────────────────────────────────────────────────────────────────────────────
// Answer / speech
// ─────────────────────────────────────────────────────────────────────────────

function resetAnswerState() {
  isRecording = false;
  $('mic-btn').classList.remove('recording');
  $('mic-icon').textContent = '🎙';
  $('mic-label').textContent = 'Start Answering';
  $('transcript-area').textContent = 'Click "Start Answering" then speak your response…';
  $('transcript-area').classList.remove('active');
}

function toggleRecording() {
  if (isSubmitting) return;

  if (!isRecording) {
    // Start
    isRecording = true;
    $('mic-btn').classList.add('recording');
    $('mic-icon').textContent = '⏹';
    $('mic-label').textContent = 'Stop Recording';
    $('transcript-area').textContent = 'Listening…';
    $('transcript-area').classList.add('active');
    SpeechService.start();
  } else {
    // Stop – SpeechService.onFinal will handle submission
    SpeechService.stop();
    $('mic-btn').disabled = true;
    $('mic-label').textContent = 'Processing…';
  }
}

function onTranscriptUpdate(text) {
  $('transcript-area').textContent = text || 'Listening…';
}

async function onFinalTranscript(text) {
  isRecording = false;

  if (!text) {
    showToast('No speech detected. Please try again.', 'error');
    resetAnswerState();
    $('mic-btn').disabled = false;
    return;
  }

  $('transcript-area').textContent = text;
  await submitAnswer(text);
}

function onSpeechError(msg) {
  isRecording = false;
  showToast(msg);
  resetAnswerState();
}

// ─────────────────────────────────────────────────────────────────────────────
// Submit answer
// ─────────────────────────────────────────────────────────────────────────────

async function submitAnswer(answerText) {
  if (isSubmitting) return;
  isSubmitting = true;

  setLoading(true, '🧠 Evaluating your answer…');

  try {
    const res = await fetch(`${API_BASE}/api/submit_answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        answer: answerText,
        is_follow_up: currentIsFollowUp,   // tells backend not to generate another follow-up
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Failed to submit answer.');
      return;
    }

    setLoading(false);
    revealKeywords();

    // Show evaluation
    if (data.evaluation) {
      displayEvaluation(data.evaluation);
    }

    // Decide next step with a small pause so user can read feedback
    setTimeout(() => {
      if (data.finished) {
        // Interview done
        updateProgress(data.progress);
        setTimeout(() => showEndScreen(), 1800);
      } else if (data.question) {
        questionNum++;
        updateProgress(data.progress);
        setTimeout(() => displayQuestion(data.question, data.progress), 2200);
      }
    }, 2500);

  } catch (err) {
    console.error(err);
    showToast('Network error while submitting answer.');
  } finally {
    isSubmitting = false;
    $('mic-btn').disabled = false;
    resetAnswerState();
  }
}

function updateProgress(progress) {
  if (!progress) return;
  const pct = (progress.current / progress.total) * 100;
  $('progress-fill').style.width = `${Math.min(pct, 100)}%`;
  $('progress-label').textContent = progress.finished
    ? `Interview Complete ✓`
    : `Question ${progress.current} / ${progress.total}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Evaluation display
// ─────────────────────────────────────────────────────────────────────────────

function displayEvaluation(ev) {
  const card = $('eval-card');
  card.classList.remove('hidden');

  const overall    = ev.overall_score    ?? 0;
  const relevance  = ev.relevance_score  ?? 0;
  const keywords   = ev.keyword_score    ?? 0;

  const setScore = (id, val) => {
    const el = $(id);
    el.textContent = `${val.toFixed(0)}%`;
    el.className   = `score-value ${scoreToColorClass(val)}`;
  };

  setScore('eval-overall',   overall);
  setScore('eval-relevance', relevance);
  setScore('eval-keywords',  keywords);

  $('eval-feedback').textContent = ev.feedback || '';

  // Scroll card into view
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ─────────────────────────────────────────────────────────────────────────────
// Skip question
// ─────────────────────────────────────────────────────────────────────────────

async function skipQuestion() {
  if (isSubmitting || isRecording) return;
  // Submit empty answer
  await submitAnswer('');
}

// ─────────────────────────────────────────────────────────────────────────────
// End screen
// ─────────────────────────────────────────────────────────────────────────────

function showEndScreen() {
  $('progress-fill').style.width = '100%';
  showScreen('end-screen');
  $('view-report-btn').href = `/report/${sessionId}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Quick-add skill tags
// ─────────────────────────────────────────────────────────────────────────────

function setupQuickTags() {
  document.querySelectorAll('#quick-tags .skill-tag').forEach(btn => {
    btn.addEventListener('click', () => {
      const skill  = btn.dataset.skill;
      const input  = $('skills-input');
      const existing = input.value.split(',').map(s => s.trim()).filter(Boolean);
      if (!existing.includes(skill)) {
        existing.push(skill);
        input.value = existing.join(', ');
      }
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Restart
// ─────────────────────────────────────────────────────────────────────────────

function restartInterview() {
  sessionId       = null;
  currentQuestion = null;
  questionNum     = 1;
  totalQuestions  = 0;
  $('progress-fill').style.width = '0%';
  $('skills-input').value = '';
  showScreen('start-screen');
}

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Initialise speech service
  SpeechService.init(onTranscriptUpdate, onFinalTranscript, onSpeechError);

  // Wire buttons
  $('start-btn').addEventListener('click', startInterview);
  $('mic-btn').addEventListener('click', toggleRecording);
  $('skip-btn').addEventListener('click', skipQuestion);
  $('restart-btn').addEventListener('click', restartInterview);

  // Allow Enter key in skills input to start
  $('skills-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') startInterview();
  });

  setupQuickTags();
  loadRoles();
});
