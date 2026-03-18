// ============================================================
// Config — update VIDEO_BASE_URL to wherever your videos are hosted
// ============================================================
const VIDEO_BASE_URL = 'https://pub-4740265da8d444f58e0cfbce5100463d.r2.dev';
const SHEETS_URL = 'https://script.google.com/macros/s/AKfycbxqEFJ6YJFI_VegExt_vBPs0TFzyFnA4yB1BabDaj_6Pohlp8X7zghFk2-lmq-RQsSc/exec';
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
let currentVideoB = null;      // video id in module B
let selectedThumb = null;      // chosen thumbnail (1-6)
let ratingsB = { quality: 0, relevance: 0, preference: 0 };

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
  await Promise.all([loadUsers(), loadAssignments(), loadVideoListA()]);
  // Check if already logged in
  const saved = localStorage.getItem('currentUser');
  if (saved) {
    currentUser = saved;
    syncUserLabels(currentUser);
    showView('view-instructions');
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

  // Hooks when entering views
  if (id === 'view-dashboard') updateFinishBtn();
  if (id === 'view-module-a') renderModuleA();
  if (id === 'view-module-b') renderModuleB();
}

// ============================================================
// Login / Logout
// ============================================================
function doLogin() {
  const uid = document.getElementById('input-uid').value.trim();
  const pwd = document.getElementById('input-pwd').value.trim();
  const errEl = document.getElementById('login-error');

  const user = users.find(u => u.id === uid && u.password === pwd);
  if (!user) {
    errEl.textContent = 'Invalid User ID or Password';
    errEl.style.display = 'block';
    return;
  }
  errEl.style.display = 'none';
  currentUser = uid;
  localStorage.setItem('currentUser', uid);
  syncUserLabels(uid);
  showView('view-instructions');
}

function doLogout() {
  currentUser = null;
  localStorage.removeItem('currentUser');
  document.getElementById('input-uid').value = '';
  document.getElementById('input-pwd').value = '';
  showView('view-login');
}

function syncUserLabels(uid) {
  document.querySelectorAll('#user-label, #user-label-instr').forEach(el => {
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

  const vids = videoListA[currentLangA];
  const prefs = getPreferences().filter(p => p.user_id === currentUser && p.language === currentLangA);
  const ratedSet = new Set(prefs.map(p => p.video_id));

  const count = vids.length;
  const ratedCount = prefs.length;
  document.getElementById('a-progress').textContent = `Completed: ${ratedCount}`;

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
  showView('view-module-a');
}

// ============================================================
// Finish button (active when >= 20 Vertical AND >= 20 Horizontal)
// ============================================================
function updateFinishBtn() {
  const allPrefs = getPreferences().filter(p => p.user_id === currentUser);
  const zhRated = allPrefs.filter(p => p.language === 'ZH').length;
  const enRated = allPrefs.filter(p => p.language === 'EN').length;
  const ready = zhRated >= 20 && enRated >= 20;
  const btn = document.getElementById('btn-finish');
  btn.disabled = !ready;
  btn.textContent = ready
    ? 'Finish A ✓'
    : `Finish A (Vertical ${zhRated}/20, Horizontal ${enRated}/20)`;
}

function finishStudy() {
  const data = getPreferences().filter(p => p.user_id === currentUser);
  const zhCount = data.filter(p => p.language === 'ZH').length;
  const enCount = data.filter(p => p.language === 'EN').length;
  if (!confirm(`Submit your ratings?\n\nVertical: ${zhCount} videos\nHorizontal: ${enCount} videos\n\nA backup file will also be downloaded.`)) return;

  const btn = document.getElementById('btn-finish');
  const status = document.getElementById('finish-status');
  btn.disabled = true;
  btn.textContent = 'Sending…';
  status.textContent = '';
  status.className = '';

  // Always download local backup immediately — data is never lost even if network fails
  exportData();

  // Google Apps Script requires no-cors + text/plain for cross-origin POST
  fetch(SHEETS_URL, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(data)
  })
    .then(() => {
      btn.textContent = 'Finish A ✓';
      status.textContent = '✓ Sent successfully. Backup file also downloaded.';
      status.className = 'finish-status-ok';
    })
    .catch(() => {
      btn.disabled = false;
      updateFinishBtn();
      status.textContent = '✗ Network error. Use "Export Data" and send the file manually.';
      status.className = 'finish-status-err';
    });
}

// ============================================================
// Module B
// ============================================================
function renderModuleB() {
  const list = document.getElementById('task-list-b');
  list.innerHTML = '';

  const vids = assignments[currentUser] || [];
  if (vids.length === 0) {
    list.innerHTML = '<p style="text-align:center;color:#999;padding:40px">No videos assigned to this user. Check data/assignments.txt.</p>';
    return;
  }

  const responses = getResponses().filter(r => r.user_id === currentUser);
  const doneSet = new Set(responses.map(r => r.video_id));
  const doneCount = vids.filter(v => doneSet.has(v)).length;
  document.getElementById('b-progress').textContent = `${doneCount} / ${vids.length} completed`;

  vids.forEach(vid => {
    const done = doneSet.has(vid);
    const item = document.createElement('div');
    item.className = 'task-item' + (done ? ' completed' : '');
    item.innerHTML = `
      <span class="task-label">Video ${vid}</span>
      <span class="task-status ${done ? 'done' : 'pending'}">${done ? 'Completed' : 'Pending'}</span>
    `;
    if (!done) item.onclick = () => openThumbSelect(vid);
    list.appendChild(item);
  });
}

function openThumbSelect(vid) {
  currentVideoB = vid;
  selectedThumb = null;
  document.getElementById('thumb-title').textContent = 'Video ' + vid + ' — Choose a Thumbnail';

  const grid = document.getElementById('thumb-grid');
  grid.innerHTML = '';

  for (let i = 1; i <= 6; i++) {
    const opt = document.createElement('div');
    opt.className = 'thumb-option';
    opt.innerHTML = `
      <span class="option-label">Option ${i}</span>
      <div class="placeholder-thumb">Thumb ${vid}-${i}</div>
    `;
    opt.onclick = () => selectThumbnail(vid, i);
    grid.appendChild(opt);
  }

  showView('view-thumb-select');
}

function selectThumbnail(vid, thumbIdx) {
  selectedThumb = thumbIdx;
  document.getElementById('player-b-title').textContent = 'Video ' + vid + ' (Thumbnail ' + thumbIdx + ')';

  const videoEl = document.getElementById('video-b');
  videoEl.querySelector('source').src = `videos/b/video_${vid}.mp4`;
  videoEl.load();

  // Reset questionnaire stars
  ratingsB = { quality: 0, relevance: 0, preference: 0 };
  buildStars('stars-b-quality', val => { ratingsB.quality = val; });
  buildStars('stars-b-relevance', val => { ratingsB.relevance = val; });
  buildStars('stars-b-preference', val => { ratingsB.preference = val; });

  showView('view-player-b');
}

function submitQuestionnaireB() {
  if (ratingsB.quality === 0 || ratingsB.relevance === 0 || ratingsB.preference === 0) {
    alert('Please fill in all three ratings.');
    return;
  }
  saveResponse({
    user_id: currentUser,
    video_id: currentVideoB,
    selected_thumbnail: selectedThumb,
    score_quality: ratingsB.quality,
    score_relevance: ratingsB.relevance,
    score_preference: ratingsB.preference,
    timestamp: new Date().toISOString()
  });
  showView('view-module-b');
}

// ============================================================
// Star rating component
// ============================================================
function buildStars(containerId, onChange) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  let current = 0;
  for (let i = 1; i <= 5; i++) {
    const star = document.createElement('span');
    star.className = 'star';
    star.textContent = '\u2605';
    star.onclick = () => {
      current = i;
      onChange(i);
      container.querySelectorAll('.star').forEach((s, idx) => {
        s.classList.toggle('active', idx < i);
      });
    };
    container.appendChild(star);
  }
}

// ============================================================
// Export data as downloadable txt
// ============================================================
function exportData() {
  const prefs = getPreferences();
  const resps = getResponses();

  let text = '=== USER PREFERENCES (Module A) ===\n';
  text += 'user_id\tlanguage\tvideo_id\trating\twatch_max_pos\tvideo_duration\twatch_ratio\ttimestamp\n';
  prefs.forEach(p => {
    text += `${p.user_id}\t${p.language || ''}\t${p.video_id}\t${p.rating}\t${p.watch_max_pos ?? ''}\t${p.video_duration ?? ''}\t${p.watch_ratio ?? ''}\t${p.timestamp}\n`;
  });

  text += '\n=== EXPERIMENT RESPONSES (Module B) ===\n';
  text += 'user_id\tvideo_id\tselected_thumbnail\tscore_quality\tscore_relevance\tscore_preference\ttimestamp\n';
  resps.forEach(r => {
    text += `${r.user_id}\t${r.video_id}\t${r.selected_thumbnail}\t${r.score_quality}\t${r.score_relevance}\t${r.score_preference}\t${r.timestamp}\n`;
  });

  const blob = new Blob([text], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `experiment_data_${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  URL.revokeObjectURL(a.href);
}
