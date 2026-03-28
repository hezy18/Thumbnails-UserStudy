// ============================================================
// Config — update VIDEO_BASE_URL to wherever your videos are hosted
// ============================================================
const VIDEO_BASE_URL = 'https://pub-4740265da8d444f58e0cfbce5100463d.r2.dev';
const SHEETS_URL = 'https://script.google.com/macros/s/AKfycbyJAwi841OeTZjUT2PIpNcOjjs6e81avLS2Yaea_7a0Z8ep8trUCIRTH5ux8g-VS-_5/exec';
// Maps internal language code → folder name in R2 bucket
const VIDEO_FOLDER = { ZH: 'a-CH', EN: 'a-EN' };

// ============================================================
// State
// ============================================================
let currentUser = null;        // logged-in user id
let users = [];                // [{id, password}]
let assignments = {};          // {userId: [videoId, ...]}
let ratingA = 0;               // temp star value for module A
let currentVideoA = null;      // video id being rated
let currentLangA = 'ZH';       // selected language for Module A ('ZH' or 'EN')
let videoListA = { ZH: [], EN: [] }; // filenames loaded from manifest
let watchMaxPos = 0;           // furthest playback position reached (seconds)
let instrLang = 'en';          // instruction page language ('en' or 'zh')
let userLang = null;           // user's selected language ('ZH' or 'EN')
let canViewChinese = false;    // EN user can understand Chinese videos
let currentVideoB = null;      // video id in module B
let selectedThumbs = [];       // chosen thumbnails (array of filenames, max 3)
let thumbManifest = {};        // loaded from thumbnail_manifest.json

// ============================================================
// Thumbnail capture queue (sequential canvas capture fallback)
// ============================================================
const thumbQueue = [];
let thumbCapturing = false;

function requestThumbnail(imgEl, videoSrc) {
  thumbQueue.push({ imgEl, videoSrc });
  if (!thumbCapturing) processThumbQueue();
}

function processThumbQueue() {
  if (thumbQueue.length === 0) { thumbCapturing = false; return; }
  thumbCapturing = true;
  const { imgEl, videoSrc } = thumbQueue.shift();

  const vid = document.createElement('video');
  vid.preload = 'metadata';
  vid.muted = true;
  vid.playsInline = true;
  vid.crossOrigin = 'anonymous';
  vid.src = videoSrc;

  const cleanup = () => { vid.src = ''; processThumbQueue(); };

  vid.addEventListener('loadedmetadata', () => { vid.currentTime = 0.5; });
  vid.addEventListener('seeked', () => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = vid.videoWidth || 320;
      canvas.height = vid.videoHeight || 180;
      canvas.getContext('2d').drawImage(vid, 0, 0);
      imgEl.src = canvas.toDataURL('image/jpeg', 0.75);
    } catch (e) { /* cross-origin or decode error — leave placeholder */ }
    cleanup();
  });
  vid.addEventListener('error', cleanup);
  // Timeout safety: skip after 8s
  setTimeout(cleanup, 8000);
}

// Persisted in localStorage
// "preferences"   -> [{user_id, language, video_id, rating, watch_max_pos, video_duration, watch_ratio, timestamp}]
// "responses"     -> [{user_id, video_id, selected_thumbnail, score_quality, score_relevance, score_preference, timestamp}]

// ============================================================
// Boot
// ============================================================
window.addEventListener('DOMContentLoaded', async () => {
  await Promise.all([loadUsers(), loadAssignments(), loadVideoListA(), loadThumbManifest()]);
  // Restore logged-in session
  const saved = localStorage.getItem('currentUser');
  if (saved) {
    currentUser = saved;
    syncUserLabels(currentUser);

    // Module B user: skip language selection entirely
    if (isModuleBUser(currentUser)) {
      if (localStorage.getItem('instrSeenB')) {
        showView('view-module-b');
      } else {
        showView('view-instr-b');
      }
      return;
    }

    const savedLang = localStorage.getItem('userLang');
    if (savedLang) {
      userLang = savedLang;
      currentLangA = savedLang === 'ZH' ? 'ZH' : 'EN';
      instrLang = savedLang === 'ZH' ? 'zh' : 'en';
      canViewChinese = localStorage.getItem('canViewChinese') === '1';
      if (localStorage.getItem('instrSeen')) {
        showView('view-module-a');
      } else {
        showView('view-instructions');
      }
    } else {
      showView('view-lang-select');
    }
  }
});

// ============================================================
// Data loading (txt files)
// ============================================================
async function loadUsers() {
  try {
    const res = await fetch('data/users.txt');
    const text = await res.text();
    users = text.trim().split('\n').filter(Boolean).map(line => {
      const [id, password] = line.split(',');
      return { id: id.trim(), password: password.trim() };
    });
  } catch (e) {
    console.error('Failed to load users.txt', e);
  }
  // Merge locally registered users from localStorage
  const local = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
  local.forEach(u => {
    if (!users.find(x => x.id === u.id)) users.push(u);
  });
}

async function loadVideoListA() {
  for (const lang of ['ZH', 'EN']) {
    try {
      const res = await fetch(`data/videos-a-${lang}.txt`);
      const text = await res.text();
      videoListA[lang] = text.trim().split('\n').filter(Boolean).map(l => l.trim());
    } catch (e) {
      console.error(`Failed to load videos-a-${lang}.txt`, e);
    }
  }
}

async function loadAssignments() {
  try {
    const res = await fetch('data/assignments.txt');
    const text = await res.text();
    text.trim().split('\n').filter(Boolean).forEach(line => {
      const [uid, vids] = line.split(':');
      assignments[uid.trim()] = vids.split(',').map(v => v.trim());
    });
  } catch (e) {
    console.error('Failed to load assignments.txt', e);
  }
}

// ============================================================
// LocalStorage helpers
// ============================================================
function getPreferences() {
  return JSON.parse(localStorage.getItem('preferences') || '[]');
}
function savePreference(entry) {
  const prefs = getPreferences();
  // Replace if same user+language+video already rated
  const idx = prefs.findIndex(p => p.user_id === entry.user_id && p.language === entry.language && p.video_id === entry.video_id);
  if (idx >= 0) prefs[idx] = entry; else prefs.push(entry);
  localStorage.setItem('preferences', JSON.stringify(prefs));
}

function getResponses() {
  return JSON.parse(localStorage.getItem('responses') || '[]');
}
function saveResponse(entry) {
  const resp = getResponses();
  const idx = resp.findIndex(r => r.user_id === entry.user_id && r.video_id === entry.video_id);
  if (idx >= 0) resp[idx] = entry; else resp.push(entry);
  localStorage.setItem('responses', JSON.stringify(resp));
}

// ============================================================
// View management
// ============================================================
function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(id).classList.add('active');

  // Stop any playing videos when leaving player views
  document.querySelectorAll('video').forEach(v => {
    if (!document.getElementById(id).contains(v)) {
      v.pause();
    }
  });

  // Hooks when entering views
  if (id === 'view-instructions') { switchInstrLang(instrLang); initInstrButton(); }
  if (id === 'view-instr-b') initInstrBButton();
  if (id === 'view-dashboard') updateFinishBtn();
  if (id === 'view-module-a') { renderModuleA(); updateModuleAFinishBtn(); }
  if (id === 'view-module-b') renderModuleB();
  if (id === 'view-player-a') updatePlayerProgress();
}

// ============================================================
// Login / Logout
// ============================================================
function doLogin() {
  const uid = document.getElementById('input-uid').value.trim();
  const pwd = document.getElementById('input-pwd').value.trim();
  const errEl = document.getElementById('login-error');

  // Accept any password if the user ID exists in assignments
  const inAssignments = uid in assignments;
  const user = users.find(u => u.id === uid && u.password === pwd);
  if (!user && !inAssignments) {
    errEl.textContent = 'Invalid User ID or Password';
    errEl.style.display = 'block';
    return;
  }
  errEl.style.display = 'none';
  currentUser = uid;
  localStorage.setItem('currentUser', uid);
  syncUserLabels(uid);
  if (isModuleBUser(uid)) {
    showView('view-instr-b');
  } else {
    showView('view-lang-select');
  }
}

function isModuleBUser(uid) {
  return assignments.hasOwnProperty(uid) && assignments[uid].length > 0;
}

function doLogout() {
  currentUser = null;
  userLang = null;
  canViewChinese = false;
  currentLangA = 'ZH';
  instrLang = 'en';
  localStorage.removeItem('currentUser');
  localStorage.removeItem('userLang');
  localStorage.removeItem('canViewChinese');
  localStorage.removeItem('instrSeen');
  localStorage.removeItem('instrSeenB');
  document.getElementById('input-uid').value = '';
  document.getElementById('input-pwd').value = '';
  toggleSignUp(false);
  showView('view-login');
}

function toggleSignUp(show) {
  document.getElementById('signin-form').style.display = show ? 'none' : '';
  document.getElementById('signup-form').style.display = show ? '' : 'none';
  document.getElementById('login-error').style.display = 'none';
}

function doSignUp() {
  const uid = document.getElementById('signup-uid').value.trim();
  const pwd = document.getElementById('signup-pwd').value.trim();
  const pwd2 = document.getElementById('signup-pwd2').value.trim();
  const errEl = document.getElementById('login-error');

  if (!uid || !pwd) {
    errEl.textContent = 'Please fill in all fields. / 请填写所有字段。';
    errEl.style.display = 'block';
    return;
  }
  if (pwd !== pwd2) {
    errEl.textContent = 'Passwords do not match. / 两次密码不一致。';
    errEl.style.display = 'block';
    return;
  }
  if (users.find(u => u.id === uid)) {
    errEl.textContent = 'User ID already exists. / 该用户名已存在。';
    errEl.style.display = 'block';
    return;
  }

  // Save to in-memory list
  users.push({ id: uid, password: pwd });

  // Persist to localStorage so this device remembers the account
  const local = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
  local.push({ id: uid, password: pwd });
  localStorage.setItem('registeredUsers', JSON.stringify(local));

  // Also send to Google Sheets for experimenter records
  try {
    fetch(SHEETS_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ signup: { user_id: uid, timestamp: new Date().toISOString() } })
    });
  } catch (e) { console.warn('Signup sheet error:', e); }

  errEl.style.display = 'none';
  // Auto sign in after registration
  document.getElementById('signup-uid').value = '';
  document.getElementById('signup-pwd').value = '';
  document.getElementById('signup-pwd2').value = '';
  toggleSignUp(false);
  currentUser = uid;
  localStorage.setItem('currentUser', uid);
  syncUserLabels(uid);
  if (isModuleBUser(uid)) {
    showView('view-instr-b');
  } else {
    showView('view-lang-select');
  }
}

function selectLang(lang) {
  userLang = lang;
  localStorage.setItem('userLang', lang);
  currentLangA = lang === 'ZH' ? 'ZH' : 'EN';
  instrLang = lang === 'ZH' ? 'zh' : 'en';
  if (lang === 'EN') {
    showView('view-chinese-check');
  } else {
    canViewChinese = true;
    localStorage.setItem('canViewChinese', '1');
    showView('view-instructions');
  }
}

function setChinese(canView) {
  canViewChinese = canView;
  localStorage.setItem('canViewChinese', canView ? '1' : '0');
  // Update English instruction step 5 based on choice
  const step5zh = document.getElementById('instr-en-step5-zh');
  const step5en = document.getElementById('instr-en-step5-en');
  if (step5zh && step5en) {
    step5zh.style.display = canView ? 'list-item' : 'none';
    step5en.style.display = canView ? 'none' : 'list-item';
  }
  showView('view-instructions');
}

function syncUserLabels(uid) {
  document.querySelectorAll('#user-label, #user-label-instr, #user-label-instr-b').forEach(el => {
    el.textContent = uid;
  });
}

// ============================================================
// Instructions page
// ============================================================
function switchInstrLang(lang) {
  instrLang = lang;
  document.getElementById('instr-en').style.display = lang === 'en' ? 'block' : 'none';
  document.getElementById('instr-zh').style.display = lang === 'zh' ? 'block' : 'none';
  document.querySelectorAll('.instr-lang-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.lang === lang);
  });
  // Update English step 5 based on canViewChinese
  const step5zh = document.getElementById('instr-en-step5-zh');
  const step5en = document.getElementById('instr-en-step5-en');
  if (step5zh && step5en) {
    step5zh.style.display = canViewChinese ? 'list-item' : 'none';
    step5en.style.display = canViewChinese ? 'none' : 'list-item';
  }
}

let instrCountdownTimer = null;
function initInstrButton() {
  const btn = document.getElementById('btn-confirm-enter');
  if (instrCountdownTimer) clearInterval(instrCountdownTimer);
  // Only enforce countdown on first visit (before instrSeen is set)
  if (localStorage.getItem('instrSeen')) {
    btn.disabled = false;
    btn.textContent = 'Confirm & Enter / 确认进入';
    return;
  }
  btn.disabled = true;
  let remaining = 10;
  const updateLabel = () => {
    btn.textContent = remaining > 0
      ? `Please read the instructions (${remaining}s) / 请阅读说明 (${remaining}s)`
      : 'Confirm & Enter / 确认进入';
    btn.disabled = remaining > 0;
  };
  updateLabel();
  instrCountdownTimer = setInterval(() => {
    remaining--;
    updateLabel();
    if (remaining <= 0) clearInterval(instrCountdownTimer);
  }, 1000);
}

// ============================================================
// Module A
// ============================================================
function switchLangA(lang) {
  currentLangA = lang;
  document.querySelectorAll('.lang-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.lang === lang);
  });
  renderModuleA();
}

function renderModuleA() {
  const grid = document.getElementById('grid-a');
  grid.innerHTML = '';

  // Sync tab highlight (handles re-entry from dashboard)
  document.querySelectorAll('.lang-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.lang === currentLangA);
  });

  // Vertical (ZH) tab uses 9:16 layout; Horizontal (EN) uses default 16:9
  grid.classList.toggle('vertical-layout', currentLangA === 'ZH');

  const vids = videoListA[currentLangA];
  const prefs = getPreferences().filter(p => p.user_id === currentUser && p.language === currentLangA);
  const ratedSet = new Set(prefs.map(p => p.video_id));

  const allPrefsProgress = getPreferences().filter(p => p.user_id === currentUser);
  const zhProgress = allPrefsProgress.filter(p => p.language === 'ZH').length;
  const enProgress = allPrefsProgress.filter(p => p.language === 'EN').length;
  let progressText;
  if (userLang === 'EN') {
    progressText = `Vertical: ${zhProgress}/Optional | Horizontal: ${enProgress}/20`;
  } else {
    progressText = `Vertical: ${zhProgress}/10 | Horizontal: ${enProgress}/10`;
  }
  document.getElementById('a-progress').textContent = progressText;

  // Update survey shortcut link text
  const shortcutLink = document.getElementById('survey-shortcut-link');
  if (shortcutLink) {
    const st = SURVEY_TEXT[userLang] || SURVEY_TEXT.EN;
    shortcutLink.textContent = st.shortcut;
  }

  vids.forEach((vid, idx) => {
    const displayNum = String(idx + 1).padStart(2, '0');
    const rated = ratedSet.has(vid);
    const card = document.createElement('div');
    card.className = 'video-card' + (rated ? ' rated' : '');

    const img = document.createElement('img');
    img.className = 'card-thumb';
    img.loading = 'lazy';
    img.alt = `Video ${displayNum}`;
    // Try pre-generated thumbnail first; on error, fall back to canvas capture
    const thumbSrc = `thumbnail/a-${currentLangA}/${vid}.jpg`;
    const videoSrc = `${VIDEO_BASE_URL}/${VIDEO_FOLDER[currentLangA]}/${vid}.mp4`;
    img.src = thumbSrc;
    img.onerror = () => { img.onerror = null; }; // show grey placeholder if missing

    const label = document.createElement('div');
    label.className = 'card-label';
    label.textContent = rated ? 'Rated ✓' : `Video ${displayNum}`;

    card.appendChild(img);
    card.appendChild(label);
    card.onclick = () => openPlayerA(vid);
    grid.appendChild(card);
  });
}

function openPlayerA(vid) {
  currentVideoA = vid;
  ratingA = 0;
  watchMaxPos = 0;
  document.getElementById('player-a-title').textContent = 'Video Rating';

  const videoEl = document.getElementById('video-a');
  videoEl.querySelector('source').src = `${VIDEO_BASE_URL}/${VIDEO_FOLDER[currentLangA]}/${vid}.mp4`;
  videoEl.load();

  // Track furthest position & block seeking (no scrubbing allowed)
  let lastSafeTime = 0;
  videoEl.ontimeupdate = () => {
    if (videoEl.currentTime > watchMaxPos) watchMaxPos = videoEl.currentTime;
    if (!videoEl.seeking) lastSafeTime = videoEl.currentTime;
  };
  videoEl.onseeking = () => {
    if (videoEl.currentTime > lastSafeTime + 1.5) {
      videoEl.currentTime = lastSafeTime;
    }
  };

  // Wire up Likert columns as the clickable rating UI
  document.querySelectorAll('.likert-col').forEach(col => {
    col.classList.remove('selected');
    col.onclick = () => {
      ratingA = parseInt(col.dataset.val);
      document.querySelectorAll('.likert-col').forEach(c => c.classList.remove('selected'));
      col.classList.add('selected');
    };
  });

  showView('view-player-a');
}

function submitRatingA() {
  if (ratingA === 0) { alert('Please select a rating.'); return; }
  const videoEl = document.getElementById('video-a');
  const duration = videoEl.duration || 0;
  const watchRatio = duration > 0 ? parseFloat((watchMaxPos / duration).toFixed(3)) : 0;
  videoEl.ontimeupdate = null;
  videoEl.onseeking = null;

  savePreference({
    user_id: currentUser,
    language: currentLangA,
    video_id: currentVideoA,
    rating: ratingA,
    watch_max_pos: parseFloat(watchMaxPos.toFixed(2)),
    video_duration: parseFloat(duration.toFixed(2)),
    watch_ratio: watchRatio,
    timestamp: new Date().toISOString()
  });

  // Show toast and return to grid for user to pick next video
  showRatingToast();
  showView('view-module-a');
}

// ============================================================
// Module A helpers — seamless navigation
// ============================================================
function getNextUnratedVideo() {
  const vids = videoListA[currentLangA];
  const prefs = getPreferences().filter(p => p.user_id === currentUser && p.language === currentLangA);
  const ratedSet = new Set(prefs.map(p => p.video_id));
  const currentIdx = vids.indexOf(currentVideoA);
  for (let i = 1; i < vids.length; i++) {
    const idx = (currentIdx + i) % vids.length;
    if (!ratedSet.has(vids[idx])) return vids[idx];
  }
  return null;
}

function openNextUnratedA() {
  const nextVid = getNextUnratedVideo();
  if (nextVid) {
    openPlayerA(nextVid);
  } else {
    showView('view-module-a');
  }
}

function backToGridA() {
  const videoEl = document.getElementById('video-a');
  videoEl.pause();
  videoEl.ontimeupdate = null;
  videoEl.onseeking = null;
  showView('view-module-a');
}

function showRatingToast() {
  const toast = document.getElementById('rating-toast');
  toast.textContent = '✓ Rating Saved / 评分已保存';
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 1200);
}

function updatePlayerProgress() {
  const allPrefs = getPreferences().filter(p => p.user_id === currentUser);
  const zhCount = allPrefs.filter(p => p.language === 'ZH').length;
  const enCount = allPrefs.filter(p => p.language === 'EN').length;
  let text;
  if (userLang === 'EN') {
    text = `Vertical: ${zhCount}/Optional | Horizontal: ${enCount}/20`;
  } else {
    text = `Vertical: ${zhCount}/10 | Horizontal: ${enCount}/10`;
  }
  const el = document.getElementById('a-progress-player');
  if (el) el.textContent = text;
}

function updateModuleAFinishBtn() {
  const allPrefs = getPreferences().filter(p => p.user_id === currentUser);
  const zhRated = allPrefs.filter(p => p.language === 'ZH').length;
  const enRated = allPrefs.filter(p => p.language === 'EN').length;
  let ready, label;
  if (userLang === 'EN') {
    ready = enRated >= 20;
    label = ready ? 'Finish A ✓' : `Finish A (${enRated}/20)`;
  } else {
    ready = zhRated >= 10 && enRated >= 10;
    label = ready ? 'Finish A ✓' : `Finish A (V${zhRated} H${enRated})`;
  }
  const btn = document.getElementById('btn-finish-a');
  if (btn) { btn.disabled = !ready; btn.textContent = label; btn.classList.toggle('btn-finish-ready', ready); }
}

function enterExperiment() {
  localStorage.setItem('instrSeen', '1');
  showView('view-module-a');
}

// ============================================================
// Finish button — thresholds differ by userLang:
//   ZH: >= 10 Vertical AND >= 10 Horizontal
//   EN: >= 20 Horizontal (Vertical optional)
// ============================================================
function updateFinishBtn() {
  const allPrefs = getPreferences().filter(p => p.user_id === currentUser);
  const zhRated = allPrefs.filter(p => p.language === 'ZH').length;
  const enRated = allPrefs.filter(p => p.language === 'EN').length;

  let ready, label;
  if (userLang === 'EN' && !canViewChinese) {
    // EN user who cannot understand Chinese: 20 horizontal, vertical optional
    ready = enRated >= 20;
    label = ready ? 'Finish A ✓' : `Finish A (Vertical ${zhRated}/optional, Horizontal ${enRated}/20)`;
  } else {
    // ZH users OR EN users who can understand Chinese: 10 each
    ready = zhRated >= 10 && enRated >= 10;
    label = ready ? 'Finish A ✓' : `Finish A (Vertical ${zhRated}/10, Horizontal ${enRated}/10)`;
  }

  const btn = document.getElementById('btn-finish');
  btn.disabled = !ready;
  btn.textContent = label;
  btn.classList.toggle('btn-finish-ready', ready);
}

function finishStudy() {
  openSurvey();
}

// ============================================================
// Post-study survey
// ============================================================
const SURVEY_TEXT = {
  EN: {
    title: 'Post-Study Survey',
    intro: 'Please answer the following questions. It should take less than 2 minute.',
    q1: 'Q1. Thinking back to the videos you rated highly (or liked), what attracted you the most? (Multiple choice)',
    q1a: 'Outstanding cover visuals: beautiful composition, comfortable colors, or clear image quality',
    q1b: 'Catchy title/text: the copy hits a pain point, or creates strong suspense',
    q1c: 'Interested in the topic itself: it happens to be a field I usually follow (e.g., food, tech)',
    q1d: 'Emotional value: the emotion conveyed by the cover (e.g., healing, funny, stunning) attracted me',
    q1e: 'High information density: I can immediately see the core content without wasting time',
    q1f: 'Person charm: the creator on the cover is attractive, or a familiar face',
    q1g: 'Other reason:',
    q2: 'Q2. For the videos you skipped or rated low, what was the main reason? (Multiple choice)',
    q2a: 'Poor cover quality: blurry image, messy layout, or outdated aesthetics',
    q2b: 'Typical "clickbait": overly exaggerated text, feels misleading, creates aversion',
    q2c: 'Content mismatch: completely not interested in that topic/field',
    q2d: 'Visual fatigue: covers all look the same, nothing fresh',
    q2e: 'Missing information: cover is too abstract, can\'t tell what the video is about',
    q2f: 'Intuitive discomfort: cover contains uncomfortable elements (e.g., deliberate ugliness, vulgarity)',
    q2g: 'Other reason:',
    q3: 'Q3. What visual style do you usually prefer when browsing video covers? (Multiple choice)',
    q3a: 'Minimalist (clean composition, minimal text)',
    q3b: 'High Information (rich elements, highlighted text)',
    q3c: 'High Saturation & Contrast (vivid colors, strong visual impact)',
    q3d: 'Natural & Documentary (real screenshots, no filters or effects)',
    q4: 'Q4. How does text on a cover affect your desire to click? (Single choice)',
    q4a: 'Very important — text directly determines whether I click',
    q4b: 'Somewhat important — serves a supplementary role',
    q4c: 'Neutral — I care more about the image',
    q4d: 'Unimportant — text even blocks the image',
    q5: 'Q5. Which elements most excite your desire to click? (Select up to 3)',
    q5a: 'Human Expressions (e.g., surprise, laughter, crying)',
    q5b: 'Action Moments (e.g., extreme sports, goals, crafting)',
    q5c: 'Key Objects & Close-ups (e.g., appetizing food, new gadgets)',
    q5d: 'Before & After Comparisons (e.g., success vs. failure)',
    q5e: 'Aesthetic & Atmosphere (e.g., scenic shots, sunsets, filters)',
    q6: 'Q6. Thinking back to the videos you rated highly, did their covers have anything in common? (Short answer)',
    q6hint: 'e.g., Bold titles, bright colors, specific subjects, etc.',
    q7: 'Q7. Which types of covers make you feel "repelled" or unlikely to click? (Multiple choice)',
    q7a: 'Clickbait / Exaggerated Text',
    q7b: 'Blurry / Low Quality',
    q7c: 'Cluttered / Eyesore Colors',
    q7d: 'Misleading Content',
    shortcut: 'Already finished? Take the brief survey here',
    alertMin: 'Please answer all required questions (Q1–Q5, Q7).',
    alertQ5: 'Q5: Please select up to 3 items.',
    otherPlaceholder: 'Please specify...'
  },
  ZH: {
    title: '实验后简短调研',
    intro: '请您回答以下问题，所需时间不超过2分钟。',
    q1: '1. 回想刚才您打高分（或选择喜欢）的视频，最吸引您的原因是？（多选）',
    q1a: '封面视觉出众：构图美观、色彩舒适或画质清晰',
    q1b: '标题/文字抓人：文案直击痛点，或者产生了强烈的悬念',
    q1c: '题材本身感兴趣：正好是我平时关注的领域（如美食、科技等）',
    q1d: '情绪价值：封面传达出的情绪（如治愈、搞笑、震撼）吸引了我',
    q1e: '信息量大：一眼就能看出视频核心内容，不浪费时间',
    q1f: '人物魅力：封面上的博主颜值高，或是我熟悉的某个面孔',
    q1g: '其他理由：',
    q2: '2. 对于那些您直接跳过或打低分的视频，主要原因是？（多选）',
    q2a: '封面质感差：画面模糊、排版凌乱或审美过时',
    q2b: '典型的"标题党"：文字过于夸张，感觉名不副实，产生反感',
    q2c: '内容不匹配：对该视频所属的领域完全不感兴趣',
    q2d: '视觉疲劳：封面风格千篇一律，没有新意',
    q2e: '信息缺失：封面太抽象，看不出视频到底要讲什么',
    q2f: '直觉上的不适：封面包含让人不适的元素（如刻意扮丑、低俗等）',
    q2g: '其他理由：',
    q3: '3. 在浏览视频封面时，您通常更偏好哪种视觉风格？（多选）',
    q3a: '极简主义（构图干净，文字少）',
    q3b: '高信息量（元素丰富，有重点文字标注）',
    q3c: '高饱和/高对比度（色彩鲜艳，视觉冲击力强）',
    q3d: '自然纪实（真实视频截图，不加滤镜或特效）',
    q4: '4. 封面上出现的文字对您的吸引力影响如何？（单选）',
    q4a: '非常重要，文字直接决定我是否点击',
    q4b: '比较重要，起补充说明作用',
    q4c: '一般，我更看重画面内容',
    q4d: '不重要，甚至觉得文字会遮挡画面',
    q5: '5. 以下哪些元素最能激发您的点击欲望？（请选择最相关的3项）',
    q5a: '人物表情（如：惊讶、大笑、哭泣）',
    q5b: '动作瞬间（如：极限运动、精彩进球、手工制作中）',
    q5c: '关键物品/特写（如：诱人的食物、新款电子产品）',
    q5d: '结果对比（如：Before & After、成功与失败的对比）',
    q5e: '美感/氛围感（如：精美的空镜、落日、滤镜感）',
    q6: '6. 回想刚才您打高分的视频，它们的封面是否有共同点？（简答）',
    q6hint: '例如：都有醒目的标题、配色都很明亮、都是小姐姐等',
    q7: '7. 哪些封面会让您感到"反感"或绝对不会点击？（多选）',
    q7a: '标题党/夸张文字',
    q7b: '画面模糊/质量低下',
    q7c: '色彩过于杂乱刺眼',
    q7d: '内容与视频主题不符',
    shortcut: '已完成？请点击此处填写简短调研',
    alertMin: '请回答所有必填问题（Q1–Q5、Q7）。',
    alertQ5: '第5题：请最多选择3项。',
    otherPlaceholder: '请简要说明…'
  }
};

function populateSurveyText() {
  const t = SURVEY_TEXT[userLang] || SURVEY_TEXT.EN;
  document.getElementById('survey-title').textContent = t.title;
  document.getElementById('survey-intro').textContent = t.intro;
  // Q1 — why high ratings
  document.getElementById('sq1-label').textContent = t.q1;
  document.getElementById('sq1-a').textContent = t.q1a;
  document.getElementById('sq1-b').textContent = t.q1b;
  document.getElementById('sq1-c').textContent = t.q1c;
  document.getElementById('sq1-d').textContent = t.q1d;
  document.getElementById('sq1-e').textContent = t.q1e;
  document.getElementById('sq1-f').textContent = t.q1f;
  document.getElementById('sq1-g').textContent = t.q1g;
  document.getElementById('sq1-other').placeholder = t.otherPlaceholder;
  // Q2 — why low ratings
  document.getElementById('sq2-label').textContent = t.q2;
  document.getElementById('sq2-a').textContent = t.q2a;
  document.getElementById('sq2-b').textContent = t.q2b;
  document.getElementById('sq2-c').textContent = t.q2c;
  document.getElementById('sq2-d').textContent = t.q2d;
  document.getElementById('sq2-e').textContent = t.q2e;
  document.getElementById('sq2-f').textContent = t.q2f;
  document.getElementById('sq2-g').textContent = t.q2g;
  document.getElementById('sq2-other').placeholder = t.otherPlaceholder;
  // Q3 — visual style
  document.getElementById('sq3-label').textContent = t.q3;
  document.getElementById('sq3-a').textContent = t.q3a;
  document.getElementById('sq3-b').textContent = t.q3b;
  document.getElementById('sq3-c').textContent = t.q3c;
  document.getElementById('sq3-d').textContent = t.q3d;
  // Q4 — text importance
  document.getElementById('sq4-label').textContent = t.q4;
  document.getElementById('sq4-a').textContent = t.q4a;
  document.getElementById('sq4-b').textContent = t.q4b;
  document.getElementById('sq4-c').textContent = t.q4c;
  document.getElementById('sq4-d').textContent = t.q4d;
  // Q5 — click elements
  document.getElementById('sq5-label').textContent = t.q5;
  document.getElementById('sq5-a').textContent = t.q5a;
  document.getElementById('sq5-b').textContent = t.q5b;
  document.getElementById('sq5-c').textContent = t.q5c;
  document.getElementById('sq5-d').textContent = t.q5d;
  document.getElementById('sq5-e').textContent = t.q5e;
  // Q6 — common features (short answer)
  document.getElementById('sq6-label').textContent = t.q6;
  document.getElementById('sq6-hint').textContent = t.q6hint;
  // Q7 — repelling covers
  document.getElementById('sq7-label').textContent = t.q7;
  document.getElementById('sq7-a').textContent = t.q7a;
  document.getElementById('sq7-b').textContent = t.q7b;
  document.getElementById('sq7-c').textContent = t.q7c;
  document.getElementById('sq7-d').textContent = t.q7d;
  // Shortcut link
  const link = document.getElementById('survey-shortcut-link');
  if (link) link.textContent = t.shortcut;
}

function openSurvey() {
  populateSurveyText();
  // Reset form
  document.querySelectorAll('#survey-form input[type="checkbox"], #survey-form input[type="radio"]').forEach(i => i.checked = false);
  document.querySelectorAll('#survey-form .survey-other-input').forEach(i => i.value = '');
  document.getElementById('sq6-answer').value = '';
  document.getElementById('survey-form').style.display = '';
  document.getElementById('survey-success').style.display = 'none';
  document.getElementById('survey-overlay').style.display = 'flex';
}

function closeSurvey() {
  document.getElementById('survey-overlay').style.display = 'none';
}

function getCheckedValues(name) {
  return Array.from(document.querySelectorAll(`input[name="${name}"]:checked`)).map(i => i.value);
}

function submitSurvey() {
  const t = SURVEY_TEXT[userLang] || SURVEY_TEXT.EN;
  const q1 = getCheckedValues('sq1');
  const q1other = document.getElementById('sq1-other').value.trim();
  const q2 = getCheckedValues('sq2');
  const q2other = document.getElementById('sq2-other').value.trim();
  const q3 = getCheckedValues('sq3');
  const q4 = getCheckedValues('sq4');
  const q5 = getCheckedValues('sq5');
  const q6 = document.getElementById('sq6-answer').value.trim();
  const q7 = getCheckedValues('sq7');

  // Validate required fields
  if (q1.length === 0 || q2.length === 0 || q3.length === 0 || q4.length === 0 || q5.length === 0 || q7.length === 0) {
    alert(t.alertMin);
    return;
  }
  if (q5.length > 3) {
    alert(t.alertQ5);
    return;
  }

  // Build "other" text into q1/q2 values if checked
  const q1vals = q1.map(v => v === 'other' && q1other ? `other: ${q1other}` : v);
  const q2vals = q2.map(v => v === 'other' && q2other ? `other: ${q2other}` : v);

  const surveyData = {
    user_id: currentUser,
    type: 'survey',
    q1_high_rating_reasons: q1vals.join(', '),
    q2_low_rating_reasons: q2vals.join(', '),
    q3_visual_style: q3.join(', '),
    q4_text_importance: q4[0],
    q5_click_elements: q5.join(', '),
    q6_common_features: q6,
    q7_repelling_covers: q7.join(', '),
    timestamp: new Date().toISOString()
  };

  // Persist to localStorage so export and retry work
  localStorage.setItem('surveyData', JSON.stringify(surveyData));

  const preferences = getPreferences().filter(p => p.user_id === currentUser);
  const payload = {
    preferences,
    survey: surveyData,
    user_language: userLang || 'unknown',
    can_view_chinese: canViewChinese
  };

  const submitBtn = document.querySelector('.btn-survey-submit');
  submitBtn.disabled = true;
  submitBtn.textContent = userLang === 'ZH' ? '提交中…' : 'Submitting…';

  // Send data to Google Sheets — no-cors POST delivers the body before the 302 redirect
  fetch(SHEETS_URL, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  })
    .then(() => {
      console.log('Google Sheets submission sent (no-cors, cannot verify response)');
    })
    .catch(err => {
      console.warn('Google Sheets submission error:', err);
    });

  // Show success immediately — no-cors responses are opaque so we can't wait for confirmation
  document.getElementById('survey-form').style.display = 'none';
  document.getElementById('survey-success').style.display = '';
  // Update finish buttons to reflect completion
  const btnA = document.getElementById('btn-finish-a');
  if (btnA) { btnA.textContent = 'Finish A ✓'; btnA.disabled = true; btnA.classList.remove('btn-finish-ready'); }
  const btnD = document.getElementById('btn-finish');
  if (btnD) { btnD.textContent = 'Finish A ✓'; btnD.disabled = true; btnD.classList.remove('btn-finish-ready'); }
}

// ============================================================
// Module B
// ============================================================

// Determine thumbnail folder based on video id (numeric → b-ZH, otherwise → b-EN)
function getThumbFolder(vid) {
  return /^\d+$/.test(vid) ? 'b-ZH' : 'b-EN';
}

// Get video URL for Module B
function getVideoBUrl(vid) {
  const folder = /^\d+$/.test(vid) ? 'b-CH' : 'b-EN';
  return `${VIDEO_BASE_URL}/${folder}/${vid}.mp4`;
}

// Static (known) thumbnail filenames — fallback when manifest is unavailable
const THUMB_FILES_ZH_DEFAULT = [
  'best_extra_high.jpg', 'best_high.jpg', 'best_low.jpg', 'best_medium.jpg',
  'best_ori.jpg', 'hpcvtg.jpg', 'initial.jpg', 'PosterO.jpg',
  'shot0002_klive.jpg', 'shot0003_showme.jpg', 'shot0006_hecate.jpg'
];
const THUMB_FILES_EN_DEFAULT = [
  'best_extra_high.jpg', 'best_high.jpg', 'best_low.jpg', 'best_medium.jpg',
  'best_ori.jpg', 'hpcvtg.jpg', 'initial.jpg', 'PosterO.jpg',
  'shot0002_klive.jpg', 'shot0003_showme.jpg', 'shot0006_hecate.jpg'
];

// Load thumbnail manifest (generated by generate_manifest.py)
async function loadThumbManifest() {
  try {
    const res = await fetch('thumbnail_manifest.json');
    if (res.ok) thumbManifest = await res.json();
  } catch (e) {
    // Manifest not available; openThumbSelect falls back to static defaults
  }
}

// Return the file list for a given folder/user/video from manifest, or static default
function getThumbFiles(folder, user, vid) {
  const files = (thumbManifest[folder] || {})[user]?.[vid];
  if (files && files.length > 0) return files;
  return folder === 'b-ZH' ? THUMB_FILES_ZH_DEFAULT : THUMB_FILES_EN_DEFAULT;
}

// Detect image orientations in the grid and apply portrait/landscape class
function detectAndApplyGridLayout(grid) {
  const imgs = Array.from(grid.querySelectorAll('img'));
  if (imgs.length === 0) return;
  let loadedCount = 0;
  let portraitCount = 0;

  function checkDone() {
    if (loadedCount < imgs.length) return;
    const landscapeCount = imgs.length - portraitCount;
    const majorityPortrait = portraitCount >= landscapeCount;
    grid.classList.toggle('landscape-grid', !majorityPortrait);
  }

  imgs.forEach(img => {
    function onLoad() {
      if (img.naturalHeight > img.naturalWidth) portraitCount++;
      loadedCount++;
      checkDone();
    }
    function onError() {
      loadedCount++;
      checkDone();
    }
    if (img.complete && img.naturalWidth > 0) {
      onLoad();
    } else if (img.complete) {
      onError();
    } else {
      img.addEventListener('load', onLoad, { once: true });
      img.addEventListener('error', onError, { once: true });
    }
  });
}

// Module B instruction page countdown
let instrBTimer = null;
function initInstrBButton() {
  const btn = document.getElementById('btn-enter-b');
  if (instrBTimer) clearInterval(instrBTimer);
  if (localStorage.getItem('instrSeenB')) {
    btn.disabled = false;
    btn.textContent = 'Confirm & Enter / 确认进入';
    return;
  }
  btn.disabled = true;
  let remaining = 10;
  const update = () => {
    btn.textContent = remaining > 0
      ? `Please read the instructions (${remaining}s) / 请阅读说明 (${remaining}s)`
      : 'Confirm & Enter / 确认进入';
    btn.disabled = remaining > 0;
  };
  update();
  instrBTimer = setInterval(() => {
    remaining--;
    update();
    if (remaining <= 0) clearInterval(instrBTimer);
  }, 1000);
}

function enterModuleB() {
  localStorage.setItem('instrSeenB', '1');
  showView('view-module-b');
}

function renderModuleB() {
  const list = document.getElementById('task-list-b');
  list.innerHTML = '';

  const vids = assignments[currentUser] || [];
  if (vids.length === 0) {
    list.innerHTML = '<p style="text-align:center;color:#999;padding:40px">No assignments available for your account. / 暂无分配的视频案例。</p>';
    document.getElementById('b-progress').textContent = 'N/A';
    return;
  }

  const responses = getResponses().filter(r => r.user_id === currentUser);
  const doneSet = new Set(responses.map(r => r.video_id));
  const doneCount = vids.filter(v => doneSet.has(v)).length;
  document.getElementById('b-progress').textContent = `${doneCount} / ${vids.length}`;

  // Enable submit button when all done
  const submitBtn = document.getElementById('btn-submit-b');
  if (submitBtn) {
    const allDone = doneCount === vids.length && vids.length > 0;
    submitBtn.disabled = !allDone;
    submitBtn.classList.toggle('btn-finish-ready', allDone);
    submitBtn.textContent = allDone ? 'Submit / 提交' : `Submit (${doneCount}/${vids.length})`;
  }

  vids.forEach((vid, i) => {
    const done = doneSet.has(vid);
    const item = document.createElement('div');
    item.className = 'task-item' + (done ? ' completed' : '');
    item.innerHTML = `
      <span class="task-label">Case ${i + 1}</span>
      <span class="task-status ${done ? 'done' : 'pending'}">${done ? 'Completed' : 'Pending'}</span>
    `;
    item.onclick = () => openThumbSelect(vid);
    list.appendChild(item);
  });
}

function openThumbSelect(vid) {
  currentVideoB = vid;
  selectedThumbs = [];
  updateThumbSelectUI();

  const vids = assignments[currentUser] || [];
  const caseIdx = vids.indexOf(vid) + 1;
  const folder = getThumbFolder(vid);
  const files = getThumbFiles(folder, currentUser, vid);
  document.getElementById('thumb-title').textContent = `Case ${caseIdx}/${vids.length}`;

  const grid = document.getElementById('thumb-grid');
  grid.innerHTML = '';
  // Reset orientation class; detectAndApplyGridLayout will set landscape-grid if needed
  grid.classList.remove('landscape-grid');

  // Shuffle (Fisher-Yates)
  const shuffled = [...files];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  shuffled.forEach((file, idx) => {
    const src = `thumbnail/${folder}/${currentUser}/${vid}/${file}`;
    const opt = document.createElement('div');
    opt.className = 'thumb-option';
    opt.dataset.file = file;
    opt.innerHTML = `
      <span class="option-label">${idx + 1}</span>
      <span class="pick-badge" style="display:none"></span>
      <img src="${src}" alt="Thumbnail ${idx + 1}" onerror="this.style.background='#333';this.alt='Image not found';">
    `;
    opt.onclick = () => toggleThumbSelection(opt, file);
    grid.appendChild(opt);
  });

  detectAndApplyGridLayout(grid);
  showView('view-thumb-select');
}

function toggleThumbSelection(opt, file) {
  const idx = selectedThumbs.indexOf(file);
  if (idx >= 0) {
    // Deselect
    selectedThumbs.splice(idx, 1);
    opt.classList.remove('selected');
  } else if (selectedThumbs.length < 3) {
    // Select
    selectedThumbs.push(file);
    opt.classList.add('selected');
  }
  // Update all pick badges
  document.querySelectorAll('#thumb-grid .thumb-option').forEach(el => {
    const badge = el.querySelector('.pick-badge');
    const f = el.dataset.file;
    const pickIdx = selectedThumbs.indexOf(f);
    if (pickIdx >= 0) {
      badge.textContent = pickIdx + 1;
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  });
  updateThumbSelectUI();
}

function updateThumbSelectUI() {
  const countEl = document.getElementById('thumb-select-count');
  const btn = document.getElementById('btn-confirm-thumb');
  if (countEl) countEl.textContent = `${selectedThumbs.length} / 3 selected`;
  if (btn) btn.disabled = selectedThumbs.length !== 3;
}

function confirmThumbSelection() {
  if (selectedThumbs.length !== 3) return;

  // Show video playback + question
  const vids = assignments[currentUser] || [];
  const caseIdx = vids.indexOf(currentVideoB) + 1;
  const responses = getResponses().filter(r => r.user_id === currentUser);
  const doneCount = responses.length; // current (before this one is saved)

  document.getElementById('video-b-title').textContent = `Case ${caseIdx}/${vids.length}`;
  const progEl = document.getElementById('b-progress-video');
  if (progEl) progEl.textContent = `${doneCount} / ${vids.length}`;

  const videoEl = document.getElementById('video-b');
  videoEl.querySelector('source').src = getVideoBUrl(currentVideoB);
  videoEl.load();
  videoEl.currentTime = 0;

  // Show first selected cover in the post-video question panel
  const folder = getThumbFolder(currentVideoB);
  const coverSrc = `thumbnail/${folder}/${currentUser}/${currentVideoB}/${selectedThumbs[0]}`;
  document.getElementById('match-cover-img').src = coverSrc;

  // Reset radio buttons
  document.querySelectorAll('input[name="match"]').forEach(r => r.checked = false);

  showView('view-video-b');
}

function submitVideoBAnswer() {
  const match = document.querySelector('input[name="match"]:checked');
  if (!match) {
    alert('Please select an answer. / 请选择一个选项。');
    return;
  }

  const videoEl = document.getElementById('video-b');
  const watchedSec = Math.round(videoEl.currentTime);
  const duration = isFinite(videoEl.duration) && videoEl.duration > 0 ? Math.round(videoEl.duration) : 0;
  const completionPct = duration > 0 ? Math.round((watchedSec / duration) * 100) : 0;

  saveResponse({
    user_id: currentUser,
    video_id: currentVideoB,
    selected_thumbnail_1: selectedThumbs[0],
    selected_thumbnail_2: selectedThumbs[1],
    selected_thumbnail_3: selectedThumbs[2],
    match_answer: match.value,
    watch_duration_sec: watchedSec,
    video_duration_sec: duration,
    watch_completion_pct: completionPct,
    timestamp: new Date().toISOString()
  });

  // Pause video
  videoEl.pause();

  // Toast
  const toast = document.getElementById('rating-toast');
  toast.textContent = '✓ Saved / 已保存';
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 1200);

  showView('view-module-b');
}

// Submit all Module B data to Google Sheets + download txt
function submitModuleB() {
  const responses = getResponses().filter(r => r.user_id === currentUser);
  const payload = { module_b: responses };

  const btn = document.getElementById('btn-submit-b');
  btn.disabled = true;
  btn.textContent = 'Submitting... / 提交中...';

  fetch(SHEETS_URL, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  }).then(() => {
    console.log('Module B data sent to Google Sheets');
  }).catch(err => {
    console.warn('Module B sheets error:', err);
  });

  // Download txt
  exportDataB();

  // Show success
  btn.textContent = 'Submitted ✓ / 已提交';
  btn.classList.remove('btn-finish-ready');

  alert('Submission successful! Your data file has been downloaded.\n提交成功！数据文件已下载。\n\nPlease send the file to the experimenter.\n请将文件发送给实验负责人。');
}

function exportDataB() {
  const resps = getResponses().filter(r => r.user_id === currentUser);
  let text = '=== MODULE B RESPONSES ===\n';
  text += 'user_id\tvideo_id\tselected_thumbnail_1\tselected_thumbnail_2\tselected_thumbnail_3\tmatch_answer\twatch_duration_sec\tvideo_duration_sec\twatch_completion_pct\ttimestamp\n';
  resps.forEach(r => {
    text += `${r.user_id}\t${r.video_id}\t${r.selected_thumbnail_1 || ''}\t${r.selected_thumbnail_2 || ''}\t${r.selected_thumbnail_3 || ''}\t${r.match_answer || ''}\t${r.watch_duration_sec ?? 0}\t${r.video_duration_sec ?? 0}\t${r.watch_completion_pct ?? 0}\t${r.timestamp}\n`;
  });

  const blob = new Blob([text], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `module_b_${currentUser}_${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ============================================================
// Export data as downloadable txt
// ============================================================
function exportData() {
  const prefs = getPreferences();
  const resps = getResponses();
  const survey = JSON.parse(localStorage.getItem('surveyData') || 'null');

  let text = '=== USER PREFERENCES (Module A) ===\n';
  text += 'user_id\tlanguage\tvideo_id\trating\twatch_max_pos\tvideo_duration\twatch_ratio\ttimestamp\n';
  prefs.forEach(p => {
    text += `${p.user_id}\t${p.language || ''}\t${p.video_id}\t${p.rating}\t${p.watch_max_pos ?? ''}\t${p.video_duration ?? ''}\t${p.watch_ratio ?? ''}\t${p.timestamp}\n`;
  });

  text += '\n=== EXPERIMENT RESPONSES (Module B) ===\n';
  text += 'user_id\tvideo_id\tselected_thumbnail_1\tselected_thumbnail_2\tselected_thumbnail_3\tmatch_answer\twatch_duration_sec\tvideo_duration_sec\twatch_completion_pct\ttimestamp\n';
  resps.forEach(r => {
    text += `${r.user_id}\t${r.video_id}\t${r.selected_thumbnail_1 || r.selected_thumbnail || ''}\t${r.selected_thumbnail_2 || ''}\t${r.selected_thumbnail_3 || ''}\t${r.match_answer || ''}\t${r.watch_duration_sec ?? 0}\t${r.video_duration_sec ?? 0}\t${r.watch_completion_pct ?? 0}\t${r.timestamp}\n`;
  });

  text += '\n=== POST-STUDY SURVEY ===\n';
  if (survey) {
    text += 'user_id\tq1_high_rating_reasons\tq2_low_rating_reasons\tq3_visual_style\tq4_text_importance\tq5_click_elements\tq6_common_features\tq7_repelling_covers\ttimestamp\n';
    text += `${survey.user_id}\t${survey.q1_high_rating_reasons}\t${survey.q2_low_rating_reasons}\t${survey.q3_visual_style}\t${survey.q4_text_importance}\t${survey.q5_click_elements}\t${survey.q6_common_features}\t${survey.q7_repelling_covers}\t${survey.timestamp}\n`;
  } else {
    text += '(No survey submitted yet)\n';
  }

  const blob = new Blob([text], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `experiment_data_${currentUser}_${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  URL.revokeObjectURL(a.href);
}
