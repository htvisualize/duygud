// =========================================================================
// NÖTR-ZİHİN v2.0 — ADVANCED FUZZY LOGIC + NEURAL NETWORK SYSTEM
// =========================================================================

// ===================== STATE MANAGER (localStorage) =====================
class StateManager {
    constructor() {
        this.storageKey = 'notr_zihin_data';
        this.state = this.load();
    }

    getDefaults() {
        return {
            profile: { name: 'Fatma Yılmaz', membership: 'Premium Üye', theme: 'light' },
            emotions: [],
            hrvReadings: [],
            breathingSessions: [],
            aiCalibration: { calibrated: false, triggers: [], safePlace: '', stressLevel: 0 },
            insights: { weeklyCoherence: [], weeklyEmotions: [], streak: 0, lastActiveDate: null },
            settings: { notifications: true, language: 'tr', hapticFeedback: true, soundEnabled: true }
        };
    }

    load() {
        try {
            const raw = localStorage.getItem(this.storageKey);
            if (raw) {
                const parsed = JSON.parse(raw);
                return { ...this.getDefaults(), ...parsed };
            }
        } catch (e) { console.warn('State load error:', e); }
        return this.getDefaults();
    }

    save() {
        try { localStorage.setItem(this.storageKey, JSON.stringify(this.state)); }
        catch (e) { console.warn('State save error:', e); }
    }

    addEmotion(emotion, emoji, intensity) {
        const entry = {
            emotion, emoji, intensity, timestamp: Date.now(),
            valence: fuzzyEngine.calculateValence(), arousal: fuzzyEngine.calculateArousal()
        };
        this.state.emotions.unshift(entry);
        if (this.state.emotions.length > 100) this.state.emotions.pop();
        this.updateStreak();
        this.save();
        return entry;
    }

    addHRV(bpm, coherence) {
        const entry = { bpm, coherence, timestamp: Date.now() };
        this.state.hrvReadings.unshift(entry);
        if (this.state.hrvReadings.length > 50) this.state.hrvReadings.pop();
        this.state.insights.weeklyCoherence.push(coherence);
        if (this.state.insights.weeklyCoherence.length > 30) this.state.insights.weeklyCoherence.shift();
        this.save();
        return entry;
    }

    addBreathing(durationSec) {
        this.state.breathingSessions.unshift({ duration: durationSec, timestamp: Date.now() });
        if (this.state.breathingSessions.length > 50) this.state.breathingSessions.pop();
        this.updateStreak();
        this.save();
    }

    saveCalibration(triggers, safePlace, stressLevel) {
        this.state.aiCalibration = { calibrated: true, triggers, safePlace, stressLevel, timestamp: Date.now() };
        this.save();
    }

    updateStreak() {
        const today = new Date().toDateString();
        if (this.state.insights.lastActiveDate !== today) {
            const yesterday = new Date(Date.now() - 86400000).toDateString();
            this.state.insights.streak = (this.state.insights.lastActiveDate === yesterday)
                ? this.state.insights.streak + 1 : 1;
            this.state.insights.lastActiveDate = today;
            this.save();
        }
    }

    getWeeklyEmotionSummary() {
        const weekAgo = Date.now() - 7 * 86400000;
        const recent = this.state.emotions.filter(e => e.timestamp > weekAgo);
        if (!recent.length) return { dominant: 'Belirsiz', positive: 0, negative: 0, count: 0 };
        const counts = {};
        let pos = 0, neg = 0;
        recent.forEach(e => {
            counts[e.emotion] = (counts[e.emotion] || 0) + 1;
            if (['Mutlu', 'Heyecanlı', 'Sakin'].includes(e.emotion)) pos++; else neg++;
        });
        const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
        return { dominant, positive: pos, negative: neg, count: recent.length };
    }

    getAvgCoherence() {
        const data = this.state.insights.weeklyCoherence;
        if (!data.length) return 0;
        return (data.reduce((s, v) => s + v, 0) / data.length).toFixed(2);
    }

    toggleTheme() {
        this.state.profile.theme = this.state.profile.theme === 'light' ? 'dark' : 'light';
        this.save(); applyTheme(this.state.profile.theme);
    }

    exportData() {
        const blob = new Blob([JSON.stringify(this.state, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url;
        a.download = `notr-zihin-backup-${new Date().toISOString().slice(0, 10)}.json`;
        a.click(); URL.revokeObjectURL(url);
    }

    clearAll() {
        if (confirm('Tüm veriler silinecek. Emin misiniz?')) {
            localStorage.removeItem(this.storageKey);
            this.state = this.getDefaults(); location.reload();
        }
    }
}

// ===================== FUZZY LOGIC ENGINE =====================
class FuzzyLogicEngine {
    constructor() {
        this.emotionScores = { mutlu: 0, heyecanli: 0, sakin: 0, yorgun: 0, kaygili: 0, uzgun: 0 };
        this.intensity = 0.5;
        this.history = [];
    }

    triangularMF(x, a, b, c) {
        if (x <= a || x >= c) return 0;
        if (x === b) return 1;
        return x < b ? (x - a) / (b - a) : (c - x) / (c - b);
    }

    trapezoidalMF(x, a, b, c, d) {
        if (x <= a || x >= d) return 0;
        if (x >= b && x <= c) return 1;
        return x < b ? (x - a) / (b - a) : (d - x) / (d - c);
    }

    fuzzifyIntensity(value) {
        return {
            veryLow: this.trapezoidalMF(value, 0, 0, 0.1, 0.25),
            low: this.triangularMF(value, 0.1, 0.25, 0.4),
            medium: this.triangularMF(value, 0.3, 0.5, 0.7),
            high: this.triangularMF(value, 0.6, 0.75, 0.9),
            veryHigh: this.trapezoidalMF(value, 0.75, 0.9, 1, 1)
        };
    }

    setEmotion(name, intensity) {
        const key = name.toLowerCase().replace('ı', 'i').replace('ü', 'u');
        const map = {
            mutlu: 'mutlu', heyecanlı: 'heyecanli', heyecanli: 'heyecanli', sakin: 'sakin',
            yorgun: 'yorgun', kaygılı: 'kaygili', kaygili: 'kaygili', üzgün: 'uzgun', uzgun: 'uzgun'
        };
        const k = map[key] || key;
        if (this.emotionScores.hasOwnProperty(k)) {
            Object.keys(this.emotionScores).forEach(ek => this.emotionScores[ek] *= 0.3);
            this.emotionScores[k] = intensity / 10;
            this.intensity = intensity / 10;
        }
    }

    calculateValence() {
        const p = this.emotionScores.mutlu + this.emotionScores.heyecanli + this.emotionScores.sakin;
        const n = this.emotionScores.yorgun + this.emotionScores.kaygili + this.emotionScores.uzgun;
        return (p - n) / (p + n + 0.0001);
    }

    calculateArousal() {
        const h = this.emotionScores.heyecanli + this.emotionScores.kaygili;
        const l = this.emotionScores.sakin + this.emotionScores.yorgun;
        return (h - l) / (h + l + 0.0001);
    }

    inferEmotionalState() {
        const valence = this.calculateValence();
        const arousal = this.calculateArousal();
        const iF = this.fuzzifyIntensity(this.intensity);
        let state = '', confidence = 0, recommendation = '', color = '', interventionType = 'none';

        if (valence > 0.3 && arousal > 0.3) {
            state = 'Heyecanlı-Pozitif'; confidence = Math.min(valence, arousal) * 100;
            recommendation = 'Enerjin yüksek! Yaratıcı işlere odaklan.'; color = '#f59e0b';
        } else if (valence > 0.3 && arousal < -0.3) {
            state = 'Sakin-Dengeli (NÖTR)'; confidence = Math.min(valence, Math.abs(arousal)) * 100;
            recommendation = 'Mükemmel! Zihnin berrak ve dengede.'; color = '#10b981';
        } else if (valence < -0.3 && arousal > 0.3) {
            state = 'Kaygılı-Stresli'; confidence = Math.min(Math.abs(valence), arousal) * 100;
            recommendation = '⚠️ Yüksek stres tespit edildi. Nefes egzersizi önerilir.'; color = '#ef4444';
            interventionType = 'breathing';
        } else if (valence < -0.3 && arousal < -0.3) {
            state = 'Depresif-Düşük Enerji'; confidence = Math.min(Math.abs(valence), Math.abs(arousal)) * 100;
            recommendation = 'Enerji düşük. Kısa bir yürüyüş önerilir.'; color = '#8b5cf6';
            interventionType = 'activity';
        } else {
            state = 'Nötr-Geçiş Halinde'; confidence = 50;
            recommendation = 'Duygu durumun belirsiz. Biraz daha veri topla.'; color = '#6b7280';
        }

        if (iF.veryHigh > 0.5) recommendation += ' ⚡ Yoğunluk çok yüksek!';

        return { state, confidence: confidence.toFixed(1), valence, arousal, recommendation, color, interventionType };
    }

    detectAnomalies() {
        if (this.history.length < 3) return null;
        const recent = this.history.slice(-3);
        const avgV = recent.reduce((s, h) => s + h.valence, 0) / 3;
        const variance = recent.reduce((s, h) => s + Math.pow(h.valence - avgV, 2), 0) / 3;
        if (variance > 0.5) return '⚠️ Duygusal dalgalanma tespit edildi. Yüksek değişkenlik var.';
        return null;
    }

    addToHistory(entry) {
        this.history.push(entry);
        if (this.history.length > 20) this.history.shift();
    }

    getCoherenceFromHRV(bpm) {
        const ideal = 65;
        const deviation = Math.abs(bpm - ideal) / 40;
        const base = Math.max(0, 1 - deviation);
        const noise = (Math.random() - 0.5) * 0.15;
        return Math.max(0.15, Math.min(0.95, base + noise));
    }
}

// ===================== GLOBALS =====================
const stateManager = new StateManager();
const fuzzyEngine = new FuzzyLogicEngine();

let isBreathing = false, breathingInterval, breathStartTime;
let hrvInterval;
let activeIntervals = [];
let activeAnimFrames = [];
let screenTransitionLock = false;

// ===================== THEME =====================
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === 'dark' ? '#0f172a' : '#f3f4f6';
}

// ===================== SCREEN NAVIGATION =====================
function switchScreen(screenId) {
    if (screenTransitionLock) return;
    screenTransitionLock = true;

    const screens = document.querySelectorAll('.screen');
    const current = document.querySelector('.screen.active');

    if (current) {
        current.classList.add('exiting');
        current.classList.remove('active');
    }

    setTimeout(() => {
        screens.forEach(s => { s.classList.remove('exiting'); s.style.display = 'none'; });
        const next = document.getElementById(screenId);
        if (next) {
            next.style.display = 'block';
            requestAnimationFrame(() => { next.classList.add('active'); });
        }
        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach(item => {
            item.classList.remove('active');
            item.setAttribute('aria-selected', 'false');
            if (item.dataset.screen === screenId) {
                item.classList.add('active');
                item.setAttribute('aria-selected', 'true');
            }
        });
        document.querySelector('.app-container')?.scrollTo(0, 0);
        screenTransitionLock = false;

        if (screenId === 'neutral') initNeutralProtocol();
        if (screenId === 'insight') renderInsights();
        if (screenId === 'dashboard') renderDashboard();
    }, 250);
}

// ===================== DASHBOARD =====================
function renderDashboard() {
    const streak = stateManager.state.insights.streak || 0;
    const streakEl = document.getElementById('streak-count');
    if (streakEl) streakEl.textContent = streak;

    const avgCoh = stateManager.getAvgCoherence();
    const cohVal = document.querySelector('.coherence-value');
    if (cohVal) cohVal.textContent = avgCoh > 0 ? Math.round(avgCoh * 100) : '72';

    const exerciseCount = stateManager.state.breathingSessions.length;
    const measureCount = stateManager.state.hrvReadings.length;
    const logCount = stateManager.state.emotions.length;
    const statEls = document.querySelectorAll('#dashboard .stat-value');
    if (statEls.length >= 3) {
        statEls[0].textContent = exerciseCount || '0';
        statEls[1].textContent = measureCount || '0';
        statEls[2].textContent = logCount || '0';
    }

    renderMiniChart('dashboard-mood-chart', stateManager.state.emotions.slice(0, 7).map(e => {
        const posEmotions = ['Mutlu', 'Heyecanlı', 'Sakin'];
        return posEmotions.includes(e.emotion) ? e.intensity : -e.intensity;
    }));
}

function renderMiniChart(canvasId, data) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !data.length) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width = canvas.offsetWidth * 2;
    const h = canvas.height = canvas.offsetHeight * 2;
    ctx.clearRect(0, 0, w, h);

    const maxAbs = Math.max(10, ...data.map(Math.abs));
    const midY = h / 2;
    const step = w / (data.length + 1);

    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, 'rgba(16, 185, 129, 0.3)');
    gradient.addColorStop(0.5, 'rgba(99, 102, 241, 0.05)');
    gradient.addColorStop(1, 'rgba(239, 68, 68, 0.3)');

    ctx.beginPath();
    ctx.moveTo(0, midY);
    data.forEach((v, i) => {
        const x = step * (i + 1);
        const y = midY - (v / maxAbs) * (h * 0.4);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.stroke();

    data.forEach((v, i) => {
        const x = step * (i + 1);
        const y = midY - (v / maxAbs) * (h * 0.4);
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fillStyle = v >= 0 ? '#10b981' : '#ef4444';
        ctx.fill();
    });
}

// ===================== BREATHING =====================
function toggleBreathing() {
    const circle = document.getElementById('breathing-circle');
    const text = document.getElementById('breathing-text');
    const btn = document.getElementById('breathing-btn');

    if (isBreathing) {
        clearInterval(breathingInterval);
        isBreathing = false;
        circle.classList.remove('inhale', 'exhale');
        text.textContent = 'HAZIR';
        btn.textContent = 'Başlat'; btn.style.background = 'var(--primary)';
        const elapsed = Math.round((Date.now() - breathStartTime) / 1000);
        if (elapsed > 5) stateManager.addBreathing(elapsed);
    } else {
        isBreathing = true; breathStartTime = Date.now();
        btn.textContent = 'Durdur'; btn.style.background = 'var(--danger)';
        breathCycle(circle, text);
        breathingInterval = setInterval(() => breathCycle(circle, text), 10000);
    }
}

function breathCycle(circle, text) {
    text.textContent = 'AL';
    circle.classList.add('inhale'); circle.classList.remove('exhale');
    setTimeout(() => {
        if (isBreathing) {
            text.textContent = 'TUT';
            setTimeout(() => {
                if (isBreathing) {
                    text.textContent = 'VER';
                    circle.classList.remove('inhale'); circle.classList.add('exhale');
                }
            }, 2000);
        }
    }, 4000);
}

// ===================== HRV =====================
function startHRV() {
    const placeholder = document.getElementById('camera-placeholder');
    const progress = document.getElementById('hrv-progress');
    const status = document.getElementById('hrv-status');
    const bpmDisplay = document.getElementById('bpm-value');
    if (placeholder.classList.contains('scanning')) return;

    placeholder.classList.add('scanning');
    status.textContent = 'Ölçüm yapılıyor...'; status.style.color = 'var(--text-muted)';
    progress.style.width = '0%';

    let width = 0, bpmSamples = [];
    hrvInterval = setInterval(() => {
        if (width >= 100) { clearInterval(hrvInterval); finishHRV(bpmSamples); }
        else {
            width += 1; progress.style.width = width + '%';
            if (width % 10 === 0) {
                const bpm = Math.floor(60 + Math.random() * 25);
                bpmSamples.push(bpm);
                bpmDisplay.textContent = bpm + ' bpm';
            }
        }
    }, 50);
}

function finishHRV(bpmSamples) {
    const placeholder = document.getElementById('camera-placeholder');
    const status = document.getElementById('hrv-status');
    const coherenceDisplay = document.getElementById('coherence-value');
    const resultContainer = document.getElementById('hrv-result-container');
    const resultCard = document.getElementById('hrv-result-card');
    const resultTitle = document.getElementById('hrv-result-title');
    const resultDesc = document.getElementById('hrv-result-desc');
    const actionBtn = document.getElementById('hrv-action-btn');
    const startBtn = document.getElementById('start-hrv-btn');

    placeholder.classList.remove('scanning');
    status.textContent = 'Ölçüm tamamlandı!'; status.style.color = 'var(--success)';

    const avgBpm = bpmSamples.length ? Math.round(bpmSamples.reduce((a, b) => a + b) / bpmSamples.length) : 72;
    const finalScore = parseFloat(fuzzyEngine.getCoherenceFromHRV(avgBpm).toFixed(2));
    coherenceDisplay.textContent = finalScore;

    stateManager.addHRV(avgBpm, finalScore);
    startBtn.style.display = 'none';
    resultContainer.style.display = 'block';

    const fuzzyState = fuzzyEngine.inferEmotionalState();
    const isCoherent = finalScore >= 0.60;

    if (isCoherent) {
        resultCard.style.borderColor = 'var(--success)'; resultCard.style.background = '#ecfdf5';
        resultTitle.textContent = 'Dengeli Frekans 🟢'; resultTitle.style.color = 'var(--success-dark)';
        resultDesc.innerHTML = `<strong>Harika!</strong><br>Koherans: ${finalScore} | BPM: ${avgBpm}<br>
            Kalp ritmin uyumlu. Beynin "Güvendeyim" sinyali alıyor.<br>
            <small style="color:var(--text-muted)">Duygusal durum: ${fuzzyState.state}</small>`;
        actionBtn.textContent = 'Ana Sayfaya Dön'; actionBtn.style.background = 'var(--success)';
        actionBtn.onclick = () => { resetHRVUI(); switchScreen('dashboard'); };
    } else {
        resultCard.style.borderColor = 'var(--warning)'; resultCard.style.background = '#fffbeb';
        resultTitle.textContent = 'Kaotik Sinyal 🔴'; resultTitle.style.color = 'var(--warning-dark)';
        resultDesc.innerHTML = `<strong>Denge Bozulmuş.</strong><br>Koherans: ${finalScore} | BPM: ${avgBpm}<br>
            Frekansını düzeltmek için nefes egzersizi yapmalısın.<br>
            <small style="color:var(--text-muted)">Duygusal durum: ${fuzzyState.state}</small>`;
        actionBtn.textContent = 'Dengele (Nefes Başlat)'; actionBtn.style.background = 'var(--primary)';
        actionBtn.onclick = () => { resetHRVUI(); switchScreen('breathing'); setTimeout(toggleBreathing, 500); };
    }

    renderHRVHistory();
}

function resetHRVUI() {
    document.getElementById('hrv-result-container').style.display = 'none';
    document.getElementById('start-hrv-btn').style.display = 'block';
    document.getElementById('hrv-status').textContent = 'Ölçüme hazır';
    document.getElementById('hrv-status').style.color = 'var(--text-muted)';
    document.getElementById('hrv-progress').style.width = '0%';
}

function renderHRVHistory() {
    const list = document.getElementById('hrv-history-list');
    if (!list) return;
    list.innerHTML = '';
    stateManager.state.hrvReadings.slice(0, 5).forEach(r => {
        const d = new Date(r.timestamp);
        const time = d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
        const label = r.coherence >= 0.6 ? 'Yüksek Koherans' : 'Düşük Koherans';
        const color = r.coherence >= 0.6 ? 'var(--success)' : 'var(--warning)';
        list.innerHTML += `<div class="setting-item">
            <div class="setting-icon" style="color:${color};background:${r.coherence >= 0.6 ? '#ecfdf5' : '#fffbeb'}">
                <i class="ph ph-heartbeat"></i></div>
            <div class="setting-content"><div class="setting-title">${label}</div>
                <div class="stat-label">${d.toLocaleDateString('tr')}, ${time}</div></div>
            <div class="stat-value" style="font-size:16px;color:${color}">${r.coherence}</div></div>`;
    });
    if (!stateManager.state.hrvReadings.length)
        list.innerHTML = '<div class="setting-item"><div class="setting-content"><div class="stat-label">Henüz ölçüm yok</div></div></div>';
}

// ===================== EMOTION =====================
let selectedEmotion = null, selectedEmoji = null;

function selectEmotion(btn, emotionName) {
    document.querySelectorAll('.emotion-button').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedEmotion = emotionName;
    selectedEmoji = btn.querySelector('.emotion-emoji').textContent;
}

function saveEmotion() {
    if (!selectedEmotion) { showToast('Lütfen önce bir duygu seçin!', 'warning'); return; }

    const intensity = parseInt(document.querySelector('.slider').value);
    fuzzyEngine.setEmotion(selectedEmotion, intensity);
    const result = fuzzyEngine.inferEmotionalState();
    fuzzyEngine.addToHistory({ valence: result.valence, arousal: result.arousal, t: Date.now() });

    stateManager.addEmotion(selectedEmotion, selectedEmoji, intensity);
    renderEmotionHistory();

    const anomaly = fuzzyEngine.detectAnomalies();
    const feedbackEl = document.getElementById('emotion-feedback');
    if (feedbackEl) {
        feedbackEl.style.display = 'block';
        feedbackEl.innerHTML = `
            <div style="font-weight:600;color:${result.color};margin-bottom:8px">${result.state}</div>
            <div style="font-size:13px;color:var(--text-muted)">${result.recommendation}</div>
            ${anomaly ? `<div style="margin-top:8px;font-size:12px;color:var(--warning)">${anomaly}</div>` : ''}
            ${result.interventionType === 'breathing' ? `<button class="btn-small" onclick="switchScreen('breathing')" style="margin-top:10px">🌬️ Nefes Egzersizi</button>` : ''}`;
        setTimeout(() => feedbackEl.style.display = 'none', 8000);
    }

    document.querySelectorAll('.emotion-button').forEach(b => b.classList.remove('selected'));
    selectedEmotion = null; selectedEmoji = null;
    document.querySelector('.slider').value = 5;

    const btn = document.querySelector('#emotion .btn-primary');
    btn.textContent = 'Kaydedildi! ✅'; btn.style.background = 'var(--success)';
    setTimeout(() => { btn.textContent = 'Kaydet'; btn.style.background = 'var(--primary-dark)'; }, 2000);
}

function renderEmotionHistory() {
    const list = document.getElementById('emotion-history-list');
    if (!list) return;
    list.innerHTML = '';
    stateManager.state.emotions.slice(0, 10).forEach(e => {
        const d = new Date(e.timestamp);
        const time = d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
        list.innerHTML += `<div class="setting-item">
            <div class="setting-icon" style="background:#f5f3ff;color:var(--primary-dark)">${e.emoji}</div>
            <div class="setting-content"><div class="setting-title">${e.emotion}</div>
                <div class="stat-label">${d.toLocaleDateString('tr')}, ${time}</div></div>
            <div class="stat-value" style="font-size:14px;color:var(--primary)">${e.intensity}/10</div></div>`;
    });
    if (!stateManager.state.emotions.length)
        list.innerHTML = '<div class="setting-item"><div class="setting-content"><div class="stat-label">Henüz kayıt yok</div></div></div>';
}

// ===================== DECISION SUPPORT =====================
function finishDecision(emotion) {
    document.getElementById('step-emotion').style.display = 'none';
    const resultEl = document.getElementById('decision-result');
    resultEl.style.display = 'block';

    const icon = document.getElementById('result-icon');
    const title = document.getElementById('result-title');
    const text = document.getElementById('result-text');

    const fuzzyState = fuzzyEngine.inferEmotionalState();
    icon.textContent = '✨'; title.textContent = 'Duygu Analizi'; title.style.color = 'var(--primary)';

    const adviceMap = {
        fear: {
            label: 'Korku Odaklı', color: 'var(--warning)',
            advice: "Korku bir uyarıcıdır. Kendine sor: 'Korkmasaydım ne yapardım?'"
        },
        desire: {
            label: 'İstek Odaklı', color: 'var(--info)',
            advice: "Heyecan güzeldir ama gerçekleri görmeni engelleyebilir. 10 dakika, 10 ay, 10 yıl kuralını uygula."
        },
        calm: {
            label: 'Sakin ve Dengeli', color: 'var(--success)',
            advice: "Zihnin berrak görünüyor. İçgüdülerine ve mantığına güvenebilirsin."
        }
    };
    const ea = adviceMap[emotion];
    text.innerHTML = `
        <div style="margin-bottom:20px;text-align:center">
            <div style="font-size:14px;color:var(--text-muted);margin-bottom:5px">Tespit Edilen Durum</div>
            <div style="font-size:24px;font-weight:700;color:${ea.color}">${ea.label}</div>
        </div>
        <div style="background:#f8fafc;padding:20px;border-radius:16px;border-left:4px solid ${ea.color}">
            <div style="font-weight:600;margin-bottom:10px">Tavsiye:</div>
            <div style="line-height:1.6">${ea.advice}</div>
        </div>
        <div style="margin-top:15px;padding:15px;background:${ea.color}15;border-radius:12px;font-size:13px;">
            <strong>Fuzzy Analiz:</strong> ${fuzzyState.state} (Güven: %${fuzzyState.confidence})<br>
            <span style="color:var(--text-muted)">${fuzzyState.recommendation}</span>
        </div>`;
}

function resetDecision() {
    document.getElementById('decision-result').style.display = 'none';
    document.getElementById('step-emotion').style.display = 'block';
}

function showDecisionTab(tab) {
    if (tab === 'wizard') {
        document.getElementById('tab-wizard').style.display = 'block';
        document.getElementById('tab-balance').style.display = 'none';
        document.getElementById('btn-tab-wizard').style.background = 'var(--primary)';
        document.getElementById('btn-tab-wizard').style.color = 'white';
        document.getElementById('btn-tab-balance').style.background = 'var(--text-muted)';
        document.getElementById('btn-tab-balance').style.color = 'white';
    } else {
        document.getElementById('tab-wizard').style.display = 'none';
        document.getElementById('tab-balance').style.display = 'block';
        document.getElementById('btn-tab-balance').style.background = 'var(--primary)';
        document.getElementById('btn-tab-balance').style.color = 'white';
        document.getElementById('btn-tab-wizard').style.background = 'var(--text-muted)';
        document.getElementById('btn-tab-wizard').style.color = 'white';
    }
}

function calculateEmotionBalance() {
    const currentState = parseInt(document.getElementById('current-state-slider').value);
    const targetState = parseInt(document.getElementById('target-state-slider').value);
    const source = document.getElementById('imbalance-source').value;

    let hataPayi = targetState - currentState;
    if (hataPayi < 0) hataPayi = 0; // if current is better than target, no error margin

    document.getElementById('error-margin').textContent = `%${hataPayi}`;

    let recommendation = "";

    switch(source) {
        case "biyoloji":
            recommendation = "Telefonu bırak, 15 dakika yürüyüş yap veya erken uyu. Fiziksel enerji dengelenmeden diğer sistemler çalışamaz.";
            break;
        case "bilis":
            recommendation = "\"Bu düşünce kesinlikle doğru mu?\" diye sor. Kendine kanıt ara ve zihnindeki bu felaket senaryosuna karşı tek bir olumlu alternatif yaz.";
            break;
        case "cevre":
            recommendation = "Sınır koy. Yapamayacağın işe hayır de veya güvendiğin bir kişiye kısa bir mesaj atıp sosyal destek al.";
            break;
        case "anlam":
            recommendation = "Büyük hedefleri bir kenara bırak. Değerlerine uygun olan en küçük, en basit işi şu an, hemen yap.";
            break;
    }

    document.getElementById('balance-recommendation').textContent = recommendation;
    document.getElementById('emotion-balance-result').style.display = 'block';
}

// ===================== NEUTRAL MIND PROTOCOL =====================
let neutralState = { phase: 1, calibrated: false, triggers: [], safePlace: '', hypnosisActive: false };
let hypnosisReq, hypnosisIntervals = [];

const aiQuestions = [
    "Seni en çok ne öfkelendirir? (Tetikleyicileri öğrenmek için)",
    "Huzurlu hissettiğin bir anı anlat. (Nötr referans noktasını belirlemek için)",
    "Şu anki stres seviyen 1 ile 10 arasında kaç?",
    "Stres altındayken bedeninde nerelerde gerginlik hissedersin?",
    "Seni en çok rahatlatan aktivite nedir?"
];
let currentQuestionIndex = 0;

function initNeutralProtocol() {
    if (stateManager.state.aiCalibration.calibrated) {
        neutralState.calibrated = true;
        neutralState.triggers = stateManager.state.aiCalibration.triggers;
        neutralState.safePlace = stateManager.state.aiCalibration.safePlace;
        showNeutralPhase(2);
    } else {
        showNeutralPhase(1);
    }
}

function showNeutralPhase(phase) {
    document.querySelectorAll('.neutral-phase').forEach(el => el.style.display = 'none');
    const el = document.getElementById(`neutral-phase-${phase}`);
    if (el) el.style.display = phase === 4 ? 'block' : 'flex';
    neutralState.phase = phase;
    if (phase === 2) startNeuralScan();
    if (phase === 3) renderPhase3Results();
}

function handleChatKey(e) { if (e.key === 'Enter') sendUserMessage(); }

function sendUserMessage() {
    const input = document.getElementById('ai-chat-input');
    const text = input.value.trim();
    if (!text) return;
    addChatMessage(text, 'user');
    input.value = '';

    if (currentQuestionIndex === 0) neutralState.triggers.push(text);
    if (currentQuestionIndex === 1) neutralState.safePlace = text;

    setTimeout(() => {
        currentQuestionIndex++;
        if (currentQuestionIndex < aiQuestions.length) {
            addChatMessage(aiQuestions[currentQuestionIndex], 'ai');
        } else {
            const stressVal = parseInt(text) || 5;
            stateManager.saveCalibration(neutralState.triggers, neutralState.safePlace, stressVal);
            addChatMessage('✅ Veriler analiz edildi. Nötr şablonun oluşturuldu. Tarama moduna geçiyoruz...', 'ai');
            neutralState.calibrated = true;
            setTimeout(() => showNeutralPhase(2), 2000);
        }
    }, 1000);
}

function addChatMessage(text, sender) {
    const container = document.getElementById('ai-chat-container');
    const div = document.createElement('div');
    div.className = `chat-message ${sender}`;
    div.textContent = text;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function startNeuralScan() {
    const viz = document.getElementById('ann-viz');
    viz.innerHTML = '';
    const nodes = [];
    for (let i = 0; i < 20; i++) {
        const node = document.createElement('div');
        node.className = 'neural-node';
        const x = Math.random() * 280, y = Math.random() * 280;
        node.style.left = x + 'px'; node.style.top = y + 'px';
        viz.appendChild(node);
        nodes.push({ el: node, x, y, vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.5) * 2 });
    }

    function animate() {
        if (neutralState.phase !== 2) return;
        nodes.forEach(n => {
            n.x += n.vx; n.y += n.vy;
            if (n.x < 0 || n.x > 288) n.vx *= -1;
            if (n.y < 0 || n.y > 288) n.vy *= -1;
            n.el.style.left = n.x + 'px'; n.el.style.top = n.y + 'px';
        });
        if (Math.random() < 0.1) {
            document.getElementById('metric-visual').textContent = Math.floor(Math.random() * 100) + '%';
            document.getElementById('metric-audio').textContent = Math.floor(Math.random() * 100) + 'Hz';
            document.getElementById('metric-haptic').textContent = Math.floor(60 + Math.random() * 40) + 'bpm';
        }
        activeAnimFrames.push(requestAnimationFrame(animate));
    }
    animate();

    const fuzzyState = fuzzyEngine.inferEmotionalState();
    const stress = stateManager.state.aiCalibration.stressLevel || 5;
    const dominantStr = stress > 6 ? `%${Math.min(95, stress * 10)} Stresli` : `%${Math.max(30, 100 - stress * 10)} Dengeli`;

    setTimeout(() => {
        document.getElementById('scan-status').textContent = `Sapma Tespit Edildi: ${dominantStr}`;
        document.getElementById('scan-status').style.color = stress > 6 ? 'var(--warning)' : 'var(--success)';
        document.getElementById('analysis-btn').style.display = 'block';
    }, 3000);
}

// ===================== PHASE 3: NEURAL ANALYSIS RESULTS =====================
function renderPhase3Results() {
    const fuzzyState = fuzzyEngine.inferEmotionalState();
    const stress = stateManager.state.aiCalibration.stressLevel || 5;
    const emotions = stateManager.state.emotions.slice(0, 5);
    const coherence = stateManager.getAvgCoherence();

    const stateEl = document.getElementById('p3-emotional-state');
    const confEl = document.getElementById('p3-confidence');
    const recEl = document.getElementById('p3-recommendation');
    const triggersEl = document.getElementById('p3-triggers');
    const coherenceEl = document.getElementById('p3-coherence');
    const stressEl = document.getElementById('p3-stress-level');

    if (stateEl) stateEl.textContent = fuzzyState.state;
    if (stateEl) stateEl.style.color = fuzzyState.color;
    if (confEl) confEl.textContent = `%${fuzzyState.confidence}`;
    if (recEl) recEl.textContent = fuzzyState.recommendation;
    if (coherenceEl) coherenceEl.textContent = coherence > 0 ? coherence : '—';
    if (stressEl) {
        stressEl.textContent = `${stress}/10`;
        stressEl.style.color = stress > 6 ? 'var(--warning)' : 'var(--success)';
    }

    const triggerList = stateManager.state.aiCalibration.triggers || [];
    if (triggersEl) triggersEl.textContent = triggerList.length ? triggerList.join(', ') : 'Henüz belirlenmedi';

    const canvas = document.getElementById('p3-radar-chart');
    if (canvas) renderRadarChart(canvas, fuzzyEngine.emotionScores);
}

function renderRadarChart(canvas, scores) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width = 260; const h = canvas.height = 260;
    const cx = w / 2, cy = h / 2, r = 100;
    ctx.clearRect(0, 0, w, h);

    const labels = ['Mutlu', 'Heyecanlı', 'Sakin', 'Yorgun', 'Kaygılı', 'Üzgün'];
    const keys = ['mutlu', 'heyecanli', 'sakin', 'yorgun', 'kaygili', 'uzgun'];
    const n = labels.length;

    // Grid
    [0.25, 0.5, 0.75, 1].forEach(scale => {
        ctx.beginPath();
        for (let i = 0; i <= n; i++) {
            const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
            const x = cx + Math.cos(angle) * r * scale;
            const y = cy + Math.sin(angle) * r * scale;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 1; ctx.stroke();
    });

    // Labels
    ctx.font = '11px Outfit'; ctx.fillStyle = '#6b7280'; ctx.textAlign = 'center';
    labels.forEach((l, i) => {
        const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
        ctx.fillText(l, cx + Math.cos(angle) * (r + 20), cy + Math.sin(angle) * (r + 20) + 4);
    });

    // Data polygon
    ctx.beginPath();
    keys.forEach((k, i) => {
        const val = Math.max(0.05, scores[k] || 0);
        const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
        const x = cx + Math.cos(angle) * r * val;
        const y = cy + Math.sin(angle) * r * val;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = 'rgba(99, 102, 241, 0.2)'; ctx.fill();
    ctx.strokeStyle = '#6366f1'; ctx.lineWidth = 2; ctx.stroke();

    // Data dots
    keys.forEach((k, i) => {
        const val = Math.max(0.05, scores[k] || 0);
        const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(angle) * r * val, cy + Math.sin(angle) * r * val, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#6366f1'; ctx.fill();
    });
}

function startHypnosis() {
    showNeutralPhase(4);
    neutralState.hypnosisActive = true;
    const canvas = document.getElementById('hypnosis-canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;
    let time = 0;

    function draw() {
        if (!neutralState.hypnosisActive) return;
        ctx.fillStyle = 'rgba(0,0,0,0.05)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const cx = canvas.width / 2, cy = canvas.height / 2;
        for (let i = 0; i < 3; i++) {
            ctx.strokeStyle = `hsla(${(time * 20 + i * 60) % 360},70%,60%,0.5)`;
            ctx.lineWidth = 2; ctx.beginPath();
            for (let j = 0; j < 100; j++) {
                const angle = (j / 50) * Math.PI * 2 + time;
                const radius = 100 + Math.sin(time * 2 + j * 0.1) * 50 + i * 40;
                const x = cx + Math.cos(angle) * radius, y = cy + Math.sin(angle) * radius;
                j === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            }
            ctx.closePath(); ctx.stroke();
        }
        time += 0.01;
        hypnosisReq = requestAnimationFrame(draw);
    }
    draw();

    const texts = ['Derinleş...', neutralState.safePlace ? `"${neutralState.safePlace}"` : 'Güvendesin...', 'Nötr...', 'Denge...', 'Sakin...'];
    let textIdx = 0;
    const tId = setInterval(() => {
        if (!neutralState.hypnosisActive) { clearInterval(tId); return; }
        const el = document.getElementById('hypnosis-text');
        el.style.opacity = 0;
        setTimeout(() => { textIdx = (textIdx + 1) % texts.length; el.textContent = texts[textIdx]; el.style.opacity = 1; }, 1000);
    }, 4000);
    hypnosisIntervals.push(tId);
}

function stopProtocol() {
    neutralState.hypnosisActive = false;
    cancelAnimationFrame(hypnosisReq);
    hypnosisIntervals.forEach(clearInterval);
    hypnosisIntervals = [];
    activeAnimFrames.forEach(cancelAnimationFrame);
    activeAnimFrames = [];
    switchScreen('dashboard');
}

// ===================== INSIGHTS =====================
function renderInsights() {
    const summary = stateManager.getWeeklyEmotionSummary();
    const avgCoh = stateManager.getAvgCoherence();
    const sessions = stateManager.state.breathingSessions.length;

    const cohEl = document.getElementById('insight-avg-coherence');
    const moodEl = document.getElementById('insight-mood-status');
    const summaryEl = document.getElementById('insight-summary-text');
    const exerciseEl = document.getElementById('insight-exercise-count');
    const emotionCountEl = document.getElementById('insight-emotion-count');

    if (cohEl) cohEl.textContent = avgCoh > 0 ? avgCoh : '—';
    if (moodEl) {
        const ratio = summary.count > 0 ? summary.positive / summary.count : 0.5;
        moodEl.textContent = ratio >= 0.6 ? 'Pozitif' : ratio >= 0.4 ? 'Nötr' : 'Negatif';
        moodEl.style.color = ratio >= 0.6 ? 'var(--success)' : ratio >= 0.4 ? 'var(--text-muted)' : 'var(--danger)';
    }
    if (exerciseEl) exerciseEl.textContent = sessions;
    if (emotionCountEl) emotionCountEl.textContent = summary.count;

    if (summaryEl) {
        if (summary.count > 0) {
            summaryEl.textContent = `Bu hafta en sık hissedilen duygu: ${summary.dominant}. ${summary.positive} pozitif, ${summary.negative} negatif kayıt var.`;
        } else {
            summaryEl.textContent = 'Henüz yeterli veri yok. Duygu günlüğünü kullanmaya başla!';
        }
    }

    renderInsightChart();
}

function renderInsightChart() {
    const canvas = document.getElementById('insight-chart');
    if (!canvas) return;
    const data = stateManager.state.insights.weeklyCoherence.slice(-14);
    if (!data.length) return;

    const ctx = canvas.getContext('2d');
    const w = canvas.width = canvas.offsetWidth * 2;
    const h = canvas.height = canvas.offsetHeight * 2;
    ctx.clearRect(0, 0, w, h);

    const step = w / (data.length + 1);
    const pad = 20;

    // Gradient fill
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(99, 102, 241, 0.25)');
    grad.addColorStop(1, 'rgba(99, 102, 241, 0)');

    ctx.beginPath(); ctx.moveTo(step, h - pad);
    data.forEach((v, i) => {
        const x = step * (i + 1);
        const y = h - pad - v * (h - pad * 2);
        ctx.lineTo(x, y);
    });
    ctx.lineTo(step * data.length, h - pad);
    ctx.closePath(); ctx.fillStyle = grad; ctx.fill();

    // Line
    ctx.beginPath();
    data.forEach((v, i) => {
        const x = step * (i + 1);
        const y = h - pad - v * (h - pad * 2);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#6366f1'; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.stroke();

    // Dots
    data.forEach((v, i) => {
        const x = step * (i + 1);
        const y = h - pad - v * (h - pad * 2);
        ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fillStyle = v >= 0.6 ? '#10b981' : '#f59e0b'; ctx.fill();
    });
}

// ===================== PROFILE =====================
function toggleNotifications() {
    stateManager.state.settings.notifications = !stateManager.state.settings.notifications;
    stateManager.save();
    const el = document.getElementById('notif-status');
    if (el) el.textContent = stateManager.state.settings.notifications ? 'Açık' : 'Kapalı';
    showToast(stateManager.state.settings.notifications ? 'Bildirimler açıldı' : 'Bildirimler kapatıldı', 'info');
}

function toggleDarkMode() {
    stateManager.toggleTheme();
    const el = document.getElementById('theme-status');
    if (el) el.textContent = stateManager.state.profile.theme === 'dark' ? 'Koyu' : 'Açık';
}

function exportData() { stateManager.exportData(); showToast('Veriler indirildi!', 'success'); }
function clearData() { stateManager.clearAll(); }

// ===================== TOAST NOTIFICATIONS =====================
function showToast(message, type = 'info') {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 3000);
}

// ===================== INIT =====================
document.addEventListener('DOMContentLoaded', () => {
    applyTheme(stateManager.state.profile.theme);
    renderDashboard();
    renderEmotionHistory();
    renderHRVHistory();

    // Restore AI calibration state
    if (stateManager.state.aiCalibration.calibrated) {
        neutralState.calibrated = true;
        neutralState.triggers = stateManager.state.aiCalibration.triggers;
        neutralState.safePlace = stateManager.state.aiCalibration.safePlace;
    }

    // Profile display
    const nameEl = document.getElementById('profile-name');
    if (nameEl) nameEl.textContent = stateManager.state.profile.name;
    const themeEl = document.getElementById('theme-status');
    if (themeEl) themeEl.textContent = stateManager.state.profile.theme === 'dark' ? 'Koyu' : 'Açık';
    const notifEl = document.getElementById('notif-status');
    if (notifEl) notifEl.textContent = stateManager.state.settings.notifications ? 'Açık' : 'Kapalı';

    console.log('🧠 Nötr-Zihin v2.0 Online');
    console.log('📊 Fuzzy Logic Engine: Active');
    console.log('💾 StateManager: Loaded', stateManager.state.emotions.length, 'emotion records');
});
