/**
 * interview.js – Main frontend logic for Vercel Deployment.
 * Stateless backend integration, Client-side Session State, Client-side MediaPipe Vision.
 */

const API_BASE = ''; 

// ─────────────────────────────────────────────────────────────────────────────
// Client-side State Definition (Stateless backend architecture)
// ─────────────────────────────────────────────────────────────────────────────
let questionsBank     = [];
let currentQuestion   = null;
let currentIsFollowUp = false;
let questionNum       = 1;
let totalQuestions    = 0;
let isRecording       = false;
let isSubmitting      = false;

// The full history to be displayed on the report page
let sessionReport = {
  role: "",
  skills: "",
  date: "",
  evaluations: []
};

// ─────────────────────────────────────────────────────────────────────────────
// DOM refs
// ─────────────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ─────────────────────────────────────────────────────────────────────────────
// Utility helpers
// ─────────────────────────────────────────────────────────────────────────────
function showScreen(name) {
  ['start-screen', 'interview-screen', 'end-screen'].forEach(id => {
    const el = $(id);
    if(el) el.classList.toggle('hidden', id !== name);
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
  const container = $('toast-container');
  if(container) container.appendChild(el);
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
// MediaPipe FaceMesh Integration (Frontend Tracking)
// ─────────────────────────────────────────────────────────────────────────────
let faceMesh;
let camera;
function initMediaPipe() {
  const videoElement = $('webcam');
  const canvasElement = $('output_canvas');
  if (!videoElement || !canvasElement) return;

  const canvasCtx = canvasElement.getContext('2d');
  
  if (typeof FaceMesh === 'undefined') {
      console.warn("FaceMesh script not loaded correctly.");
      return;
  }

  faceMesh = new FaceMesh({locateFile: (file) => {
    return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`;
  }});

  faceMesh.setOptions({
    maxNumFaces: 1,
    refineLandmarks: true,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
  });

  faceMesh.onResults((results) => {
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    
    let poseLabel = "No face detected";
    let color = "#0066ff";

    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
      const landmarks = results.multiFaceLandmarks[0];
      
      // Draw minimal face mesh lines for "tech" effect
      drawConnectors(canvasCtx, landmarks, FACEMESH_TESSELATION, {color: '#00dc5022', lineWidth: 1});
      drawConnectors(canvasCtx, landmarks, FACEMESH_RIGHT_EYE, {color: '#00dc50'});
      drawConnectors(canvasCtx, landmarks, FACEMESH_LEFT_EYE, {color: '#00dc50'});
      
      // Heuristic Head Pose
      const noseTip = landmarks[1];
      const leftEye = landmarks[33];
      const rightEye = landmarks[263];
      
      // Rough estimation based on nose orientation vs eyes
      const eyeDistX = rightEye.x - leftEye.x;
      const noseRatioX = (noseTip.x - leftEye.x) / eyeDistX;
      const noseRatioY = noseTip.y; // 0 to 1

      if (noseRatioX < 0.35) poseLabel = "Looking Right";
      else if (noseRatioX > 0.65) poseLabel = "Looking Left";
      else if (noseRatioY < 0.40) poseLabel = "Looking Up";
      else if (noseRatioY > 0.65) poseLabel = "Looking Down";
      else {
        poseLabel = "Forward ✓";
        color = "#00dc50"; // Green
      }
    }
    
    const plabel = $('pose-label');
    if (plabel) {
        plabel.textContent = `Head Pose: ${poseLabel}`;
        plabel.style.color = color;
    }
    canvasCtx.restore();
  });

  camera = new Camera(videoElement, {
    onFrame: async () => {
      // scale canvas to match video element
      canvasElement.width = videoElement.videoWidth;
      canvasElement.height = videoElement.videoHeight;
      await faceMesh.send({image: videoElement});
    },
    width: 640,
    height: 480
  });
  camera.start();
}


// ─────────────────────────────────────────────────────────────────────────────
// Roles
// ─────────────────────────────────────────────────────────────────────────────
async function loadRoles() {
  try {
    const res  = await fetch(`${API_BASE}/api/roles`);
    const data = await res.json();
    const sel  = $('role-select');
    if(!sel) return;
    sel.innerHTML = '<option value="" disabled selected>Choose a role…</option>';
    (data.roles || []).forEach(role => {
      const opt = document.createElement('option');
      opt.value       = role;
      opt.textContent = role;
      sel.appendChild(opt);
    });
  } catch (err) {
    showToast('Could not load roles. API might be asleep.');
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

  setLoading(true, '🤖 Generating your personalised interview using LLM…');
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

    // Save state completely locally
    questionsBank  = data.questions;
    totalQuestions = questionsBank.length;
    questionNum    = 1;
    
    sessionReport = {
        role: role,
        skills: skills,
        date: new Date().toISOString(),
        evaluations: []
    };

    setLoading(false);
    showScreen('interview-screen');
    
    // Boot up MediaPipe camera now that we are on the interview screen
    initMediaPipe();
    
    displayQuestion(questionsBank[0]);

  } catch (err) {
    showToast('Network error. Make sure the backend is running.');
    console.error(err);
  } finally {
    setLoading(false);
    $('start-btn').disabled = false; // re-enable if errored
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Question display
// ─────────────────────────────────────────────────────────────────────────────
function displayQuestion(question) {
  currentQuestion   = question;
  currentIsFollowUp = (question.type === 'follow_up');

  // Update Progress UI
  const pct = ((questionNum - 1) / totalQuestions) * 100;
  $('progress-fill').style.width = `${pct}%`;
  $('progress-label').textContent = `Question ${questionNum} / ${totalQuestions}`;
  $('question-number').textContent = `#${String(questionNum).padStart(2, '0')}`;

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

  setLoading(true, '🧠 LLM Analyzing your answer…');

  try {
    const res = await fetch(`${API_BASE}/api/submit_answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: currentQuestion,
        answer: answerText,
        is_follow_up: currentIsFollowUp,
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
      
      // Save locally to sessionReport array
      sessionReport.evaluations.push({
          question: currentQuestion.question,
          answer: answerText,
          score: data.evaluation.overall_score || 0,
          feedback: data.evaluation.feedback || '',
          type: currentQuestion.type || 'general'
      });
    }

    // Decide next step with a small pause so user can read feedback
    setTimeout(() => {
      // If a follow up was generated
      if (data.follow_up_question) {
        displayQuestion(data.follow_up_question);
      } else {
        // Proceed to next main question in array
        questionNum++;
        
        if (questionNum > totalQuestions) {
          // Finished
          showEndScreen();
        } else {
          // Display next
          displayQuestion(questionsBank[questionNum - 1]);
        }
      }
    }, 2800);

  } catch (err) {
    console.error(err);
    showToast('Network error while submitting answer.');
  } finally {
    isSubmitting = false;
    if($('mic-btn')) $('mic-btn').disabled = false;
    resetAnswerState();
  }
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

async function skipQuestion() {
  if (isSubmitting || isRecording) return;
  await submitAnswer('');
}

// ─────────────────────────────────────────────────────────────────────────────
// End screen
// ─────────────────────────────────────────────────────────────────────────────
function showEndScreen() {
  $('progress-fill').style.width = '100%';
  $('progress-label').textContent = 'Interview Complete ✓';
  
  // Calculate average overall score for report
  let sum = 0;
  sessionReport.evaluations.forEach(e => sum += e.score);
  sessionReport.overall_score = sessionReport.evaluations.length > 0 ? (sum / sessionReport.evaluations.length) : 0;
  
  // Dump session report to local storage so report.html can pick it up
  localStorage.setItem("sessionReport", JSON.stringify(sessionReport));

  if (camera) {
      camera.stop(); 
  }

  showScreen('end-screen');
  const btn = $('view-report-btn');
  if (btn) btn.href = '/report/stats';
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
  questionsBank     = [];
  currentQuestion   = null;
  questionNum       = 1;
  totalQuestions    = 0;
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

  $('skills-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') startInterview();
  });

  setupQuickTags();
  loadRoles();
});
