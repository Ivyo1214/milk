/**
 * companion.js — 陪伴功能模块
 * 依赖：localforage, APP_PREFIX, getStorageKey, showNotification
 */

(function () {
    'use strict';

    // ─── 常量 ────────────────────────────────────────────────────────────────

    const STORAGE_KEY = 'companionData';

    const MODES = {
        study:    { label: '陪我学习', icon: 'fa-book-open',    hint: '专注学习中...',  times: [5,10,15,20,25,30] },
        work:     { label: '陪我工作', icon: 'fa-laptop-code',  hint: '认真工作中...',  times: [5,10,15,20,25,30] },
        exercise: { label: '陪我运动', icon: 'fa-person-running',hint: '运动加油中...',  times: [5,10,15,20,25,30] },
        sleep:    { label: '陪我睡觉', icon: 'fa-moon',         hint: '陪你入睡...',    times: [10,20,30,60,'rest'] },
    };

    // ─── 运行时状态 ──────────────────────────────────────────────────────────

    let companionData = {
        backgrounds: { study: [], work: [], exercise: [], sleep: [] },
        voices: [],
        history: []
    };

    let currentMode   = null;   // 'study' | 'work' | 'exercise' | 'sleep'
    let timerInterval = null;
    let timerSeconds  = 0;
    let isCountdown   = true;   // false = 正计时（好好休息）
    let totalSeconds  = 0;
    let currentAudio  = null;
    let isVoicePanelOpen = false;

    // ─── 存储 ────────────────────────────────────────────────────────────────

    async function loadCompanionData() {
        try {
            const key = typeof getStorageKey === 'function'
                ? getStorageKey(STORAGE_KEY)
                : (window.APP_PREFIX || 'CHAT_APP_V3_') + STORAGE_KEY;
            const saved = await localforage.getItem(key);
            if (saved) {
                // 深度合并，确保旧数据结构兼容
                companionData = Object.assign({
                    backgrounds: { study: [], work: [], exercise: [], sleep: [] },
                    voices: [],
                    history: []
                }, saved);
                // 确保每个场景的 backgrounds 数组存在
                for (const m of Object.keys(MODES)) {
                    if (!companionData.backgrounds[m]) companionData.backgrounds[m] = [];
                }
            }
        } catch (e) {
            console.warn('[companion] 加载数据失败', e);
        }
    }

    async function saveCompanionData() {
        try {
            const key = typeof getStorageKey === 'function'
                ? getStorageKey(STORAGE_KEY)
                : (window.APP_PREFIX || 'CHAT_APP_V3_') + STORAGE_KEY;
            await localforage.setItem(key, companionData);
        } catch (e) {
            console.warn('[companion] 保存数据失败', e);
        }
    }

    // ─── 文件读取工具 ────────────────────────────────────────────────────────

    function readFileAsBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => resolve(e.target.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    function generateId() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    }

    // ─── DOM 工具 ────────────────────────────────────────────────────────────

    function $(id) { return document.getElementById(id); }

    function notify(msg, type = 'info') {
        if (typeof showNotification === 'function') showNotification(msg, type);
    }

    // ─── 弹窗：陪伴选择（第一层：选场景）────────────────────────────────────

    function openCompanionModal() {
        $('companion-modal').classList.add('active');
    }

    function closeCompanionModal() {
        $('companion-modal').classList.remove('active');
    }

    // ─── 选择场景后：判断是否首次，决定走初始化还是直接进入 ──────────────────

    async function selectMode(mode) {
        currentMode = mode;
        closeCompanionModal();

        const hasBg = companionData.backgrounds[mode] && companionData.backgrounds[mode].length > 0;

        if (!hasBg) {
            // 首次进入该场景 → 初始化流程
            openSetupModal(mode);
        } else {
            // 已有背景 → 直接进入陪伴页
            openTimeModal(mode);
        }
    }

    // ─── 初始化流程（首次）──────────────────────────────────────────────────

    function openSetupModal(mode) {
        const cfg = MODES[mode];
        $('setup-modal-title').textContent = cfg.label;
        $('setup-modal-icon').className = `fas ${cfg.icon}`;
        $('setup-step-bg').style.display = 'block';
        $('setup-step-voice').style.display = 'none';
        $('setup-bg-preview').innerHTML = '';
        $('setup-bg-preview').style.display = 'none';
        $('setup-btn-next').style.display = 'none';
        $('setup-modal').classList.add('active');
        window._setupPendingBg = null;
    }

    function closeSetupModal() {
        $('setup-modal').classList.remove('active');
        window._setupPendingBg = null;
        window._setupPendingVoices = [];
    }

    // 步骤1：背景上传
    async function handleSetupBgUpload(e) {
        const file = e.target.files[0];
        if (!file) return;

        const maxBytes = 100 * 1024 * 1024; // 100MB
        if (file.size > maxBytes) {
            notify('文件超过 100MB，建议使用更小的文件以避免加载缓慢', 'warning');
        }

        const isVideo = file.type.startsWith('video/');
        const isImage = file.type.startsWith('image/');
        if (!isVideo && !isImage) {
            notify('请上传图片（jpg/png/gif/webp）或视频（mp4/mov）文件', 'error');
            return;
        }

        try {
            notify('正在处理文件...', 'info');
            const base64 = await readFileAsBase64(file);
            window._setupPendingBg = { type: isVideo ? 'video' : 'image', data: base64, name: file.name };

            // 显示预览
            const preview = $('setup-bg-preview');
            preview.innerHTML = '';
            if (isVideo) {
                const v = document.createElement('video');
                v.src = base64; v.muted = true; v.autoplay = true; v.loop = true; v.playsInline = true;
                preview.appendChild(v);
            } else {
                const img = document.createElement('img');
                img.src = base64;
                preview.appendChild(img);
            }
            preview.style.display = 'block';
            $('setup-btn-next').style.display = 'inline-flex';
        } catch (err) {
            notify('文件读取失败，请重试', 'error');
            console.error(err);
        }
        e.target.value = '';
    }

    // 步骤1完成 → 进入步骤2（语音）
    function setupGoToVoice() {
        if (!window._setupPendingBg) {
            notify('请先上传背景', 'warning');
            return;
        }
        $('setup-step-bg').style.display = 'none';
        $('setup-step-voice').style.display = 'block';
        window._setupPendingVoices = [];
        renderSetupVoiceList();
    }

    // 步骤2：语音上传
    async function handleSetupVoiceUpload(e) {
        const files = Array.from(e.target.files);
        if (!files.length) return;

        for (const file of files) {
            if (!file.type.startsWith('audio/')) {
                notify(`${file.name} 不是音频文件，已跳过`, 'warning');
                continue;
            }
            try {
                const base64 = await readFileAsBase64(file);
                window._setupPendingVoices = window._setupPendingVoices || [];
                window._setupPendingVoices.push({
                    id: generateId(),
                    data: base64,
                    name: file.name.replace(/\.[^/.]+$/, ''), // 去掉扩展名作为默认名
                    addedAt: Date.now()
                });
            } catch (err) {
                notify(`${file.name} 读取失败`, 'error');
            }
        }
        renderSetupVoiceList();
        e.target.value = '';
    }

    function renderSetupVoiceList() {
        const list = $('setup-voice-list');
        const voices = window._setupPendingVoices || [];
        if (!voices.length) {
            list.innerHTML = '<p class="companion-empty-hint">暂无语音，可跳过</p>';
            return;
        }
        list.innerHTML = voices.map((v, i) => `
            <div class="companion-voice-item" data-id="${v.id}">
                <i class="fas fa-music"></i>
                <input class="companion-voice-name-input" type="text" value="${v.name}"
                    onchange="window._updateSetupVoiceName(${i}, this.value)" placeholder="语音备注名">
                <button class="companion-voice-delete" onclick="window._removeSetupVoice('${v.id}')">
                    <i class="fas fa-trash-can"></i>
                </button>
            </div>
        `).join('');
    }

    window._updateSetupVoiceName = (idx, val) => {
        if (window._setupPendingVoices && window._setupPendingVoices[idx]) {
            window._setupPendingVoices[idx].name = val;
        }
    };
    window._removeSetupVoice = (id) => {
        window._setupPendingVoices = (window._setupPendingVoices || []).filter(v => v.id !== id);
        renderSetupVoiceList();
    };

    // 完成初始化 → 保存并进入陪伴页
    async function finishSetup() {
        if (!window._setupPendingBg) {
            notify('请先上传背景图片或视频', 'warning');
            return;
        }

        // 保存背景
        const bg = {
            id: generateId(),
            type: window._setupPendingBg.type,
            data: window._setupPendingBg.data,
            name: window._setupPendingBg.name,
            addedAt: Date.now()
        };
        companionData.backgrounds[currentMode].push(bg);

        // 保存语音（追加到全局语音库）
        if (window._setupPendingVoices && window._setupPendingVoices.length) {
            companionData.voices.push(...window._setupPendingVoices);
        }

        await saveCompanionData();
        closeSetupModal();
        notify('设置完成！', 'success');

        // 进入时间选择
        openTimeModal(currentMode);
    }

    // ─── 时间选择弹窗 ────────────────────────────────────────────────────────

    function openTimeModal(mode) {
        const cfg = MODES[mode];
        $('time-modal-title').textContent = cfg.label;
        $('time-modal-icon').className = `fas ${cfg.icon}`;

        const grid = $('time-options-grid');
        grid.innerHTML = cfg.times.map(t => {
            if (t === 'rest') {
                return `<button class="companion-time-btn" data-time="rest" onclick="window._selectTime('rest')">
                    <i class="fas fa-cloud-moon"></i><span>好好休息</span>
                </button>`;
            }
            return `<button class="companion-time-btn" data-time="${t}" onclick="window._selectTime(${t})">
                <span class="time-number">${t}</span><span class="time-unit">分钟</span>
            </button>`;
        }).join('');

        $('time-modal').classList.add('active');
    }

    function closeTimeModal() {
        $('time-modal').classList.remove('active');
    }

    window._selectTime = function (t) {
        closeTimeModal();
        if (t === 'rest') {
            isCountdown = false;
            timerSeconds = 0;
            totalSeconds = 0;
        } else {
            isCountdown = true;
            timerSeconds = t * 60;
            totalSeconds = t * 60;
        }
        openCompanionPage();
    };

    // ─── 陪伴页面 ────────────────────────────────────────────────────────────

    function openCompanionPage() {
        const cfg = MODES[currentMode];
        const page = $('companion-page');

        // 设置背景
        const bgs = companionData.backgrounds[currentMode];
        const bg = bgs[Math.floor(Math.random() * bgs.length)];
        renderCompanionBackground(bg);

        // 设置提示文字
        $('companion-hint-text').textContent = cfg.hint;

        // 初始化计时器显示
        updateTimerDisplay();

        // 显示页面
        page.classList.add('active');
        document.body.style.overflow = 'hidden';

        // 启动计时器
        startTimer();
    }

    function renderCompanionBackground(bg) {
        const container = $('companion-bg-container');
        container.innerHTML = '';
        if (!bg) return;

        if (bg.type === 'video') {
            const v = document.createElement('video');
            v.src = bg.data;
            v.muted = true;
            v.autoplay = true;
            v.loop = true;
            v.playsInline = true;
            v.className = 'companion-bg-media';
            container.appendChild(v);
        } else {
            const img = document.createElement('img');
            img.src = bg.data;
            img.className = 'companion-bg-media';
            container.appendChild(img);
        }
    }

    function closeCompanionPage() {
        stopTimer();
        recordHistory();

        // 停止音频
        if (currentAudio) {
            currentAudio.pause();
            currentAudio = null;
        }

        $('companion-page').classList.remove('active');
        document.body.style.overflow = '';
        closeSettingsPanel();
        $('companion-exit-confirm').classList.remove('active');
    }

    // ─── 计时器 ──────────────────────────────────────────────────────────────

    function startTimer() {
        clearInterval(timerInterval);
        timerInterval = setInterval(() => {
            if (isCountdown) {
                timerSeconds--;
                if (timerSeconds <= 0) {
                    timerSeconds = 0;
                    updateTimerDisplay();
                    stopTimer();
                    onTimerEnd();
                    return;
                }
            } else {
                timerSeconds++;
            }
            updateTimerDisplay();
        }, 1000);
    }

    function stopTimer() {
        clearInterval(timerInterval);
        timerInterval = null;
    }

    function updateTimerDisplay() {
        const el = $('companion-timer-display');
        if (!el) return;
        const s = isCountdown ? timerSeconds : timerSeconds;
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = s % 60;
        if (h > 0) {
            el.textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
        } else {
            el.textContent = `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
        }

        // 倒计时时更新进度环
        if (isCountdown && totalSeconds > 0) {
            const pct = timerSeconds / totalSeconds;
            const circle = document.querySelector('#companion-timer-ring .timer-ring-progress');
            if (circle) {
                const circumference = 2 * Math.PI * 36;
                circle.style.strokeDashoffset = circumference * (1 - pct);
            }
        }
    }

    function onTimerEnd() {
        // 震动提示
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);

        // 播放随机语音
        playRandomVoice();

        // 显示结束提示
        const hint = $('companion-hint-text');
        if (hint) {
            hint.textContent = '时间到啦 ✦';
            setTimeout(() => {
                if (hint) hint.textContent = MODES[currentMode]?.hint || '';
            }, 3000);
        }
    }

    // ─── 语音播放 ────────────────────────────────────────────────────────────

    function playRandomVoice() {
        if (!companionData.voices || !companionData.voices.length) return;
        const voices = companionData.voices;
        const v = voices[Math.floor(Math.random() * voices.length)];
        playVoice(v);
    }

    function playVoice(v) {
        if (!v || !v.data) return;
        if (currentAudio) {
            currentAudio.pause();
            currentAudio = null;
        }
        const audio = new Audio(v.data);
        audio.play().catch(e => console.warn('[companion] 播放失败', e));
        currentAudio = audio;
    }

    // 点击空白区域播放
    function handlePageClick(e) {
        // 排除按钮点击
        if (e.target.closest('button, input, .companion-settings-panel, #companion-timer-area')) return;
        if (!companionData.voices || !companionData.voices.length) {
            notify('还没有上传语音哦，可在设置中添加', 'info');
            return;
        }
        playRandomVoice();
    }

    // ─── 设置面板（右侧滑出）────────────────────────────────────────────────

    function openSettingsPanel() {
        isVoicePanelOpen = false;
        renderSettingsPanel();
        $('companion-settings-panel').classList.add('active');
    }

    function closeSettingsPanel() {
        $('companion-settings-panel').classList.remove('active');
    }

    function renderSettingsPanel() {
        renderVoiceManagerInPanel();
    }

    function renderVoiceManagerInPanel() {
        const list = $('panel-voice-list');
        const voices = companionData.voices;
        if (!voices.length) {
            list.innerHTML = '<p class="companion-empty-hint">还没有上传语音</p>';
            return;
        }
        list.innerHTML = voices.map(v => `
            <div class="companion-voice-item" data-id="${v.id}">
                <i class="fas fa-music"></i>
                <input class="companion-voice-name-input" type="text" value="${v.name}"
                    onchange="window._updateVoiceName('${v.id}', this.value)" placeholder="语音名称">
                <button class="companion-voice-play" onclick="window._playVoiceById('${v.id}')" title="试听">
                    <i class="fas fa-play"></i>
                </button>
                <button class="companion-voice-delete" onclick="window._deleteVoice('${v.id}')" title="删除">
                    <i class="fas fa-trash-can"></i>
                </button>
            </div>
        `).join('');
    }

    window._updateVoiceName = async (id, val) => {
        const v = companionData.voices.find(x => x.id === id);
        if (v) { v.name = val; await saveCompanionData(); }
    };
    window._playVoiceById = (id) => {
        const v = companionData.voices.find(x => x.id === id);
        playVoice(v);
    };
    window._deleteVoice = async (id) => {
        companionData.voices = companionData.voices.filter(x => x.id !== id);
        await saveCompanionData();
        renderVoiceManagerInPanel();
        notify('语音已删除', 'success');
    };

    // 面板内上传新语音
    async function handlePanelVoiceUpload(e) {
        const files = Array.from(e.target.files);
        for (const file of files) {
            if (!file.type.startsWith('audio/')) { notify(`${file.name} 不是音频文件`, 'warning'); continue; }
            const base64 = await readFileAsBase64(file);
            companionData.voices.push({
                id: generateId(),
                data: base64,
                name: file.name.replace(/\.[^/.]+$/, ''),
                addedAt: Date.now()
            });
        }
        await saveCompanionData();
        renderVoiceManagerInPanel();
        notify('语音已添加', 'success');
        e.target.value = '';
    }

    // 面板内换背景
    async function handlePanelBgUpload(e) {
        const file = e.target.files[0];
        if (!file) return;
        const isVideo = file.type.startsWith('video/');
        const isImage = file.type.startsWith('image/');
        if (!isVideo && !isImage) { notify('请上传图片或视频', 'error'); return; }
        if (file.size > 100 * 1024 * 1024) notify('文件超过 100MB，加载可能较慢', 'warning');

        notify('正在处理...', 'info');
        const base64 = await readFileAsBase64(file);
        const bg = { id: generateId(), type: isVideo ? 'video' : 'image', data: base64, name: file.name, addedAt: Date.now() };
        companionData.backgrounds[currentMode].push(bg);
        await saveCompanionData();

        // 立即切换背景
        renderCompanionBackground(bg);
        closeSettingsPanel();
        notify('背景已更换', 'success');
        e.target.value = '';
    }

    // ─── 退出确认 ────────────────────────────────────────────────────────────

    function showExitConfirm() {
        $('companion-exit-confirm').classList.add('active');
    }
    function hideExitConfirm() {
        $('companion-exit-confirm').classList.remove('active');
    }

    // ─── 历史记录 ────────────────────────────────────────────────────────────

    async function recordHistory() {
        const elapsed = isCountdown ? (totalSeconds - timerSeconds) : timerSeconds;
        if (elapsed < 5) return; // 不足5秒不记录
        companionData.history = companionData.history || [];
        companionData.history.unshift({
            mode: currentMode,
            duration: elapsed,
            date: new Date().toISOString().slice(0, 10)
        });
        // 只保留最近 100 条
        if (companionData.history.length > 100) companionData.history = companionData.history.slice(0, 100);
        await saveCompanionData();
    }

    // ─── 初始化：绑定所有事件 ────────────────────────────────────────────────

    function bindEvents() {
        // 顶部按钮
        const entryBtn = $('companion-btn');
        if (entryBtn) entryBtn.addEventListener('click', handleEntryClick);

        // 陪伴选择弹窗
        const modal = $('companion-modal');
        if (modal) {
            modal.addEventListener('click', e => {
                if (e.target === modal) closeCompanionModal();
            });
        }
        document.querySelectorAll('.companion-mode-card').forEach(card => {
            card.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                selectMode(card.dataset.mode);
            });
        });
        const closeModalBtn = $('companion-modal-close');
        if (closeModalBtn) closeModalBtn.addEventListener('click', closeCompanionModal);

        // 初始化弹窗
        const setupBgInput = $('setup-bg-input');
        if (setupBgInput) setupBgInput.addEventListener('change', handleSetupBgUpload);

        const setupBgTrigger = $('setup-bg-trigger');
        if (setupBgTrigger) setupBgTrigger.addEventListener('click', () => $('setup-bg-input').click());

        const setupVoiceInput = $('setup-voice-input');
        if (setupVoiceInput) setupVoiceInput.addEventListener('change', handleSetupVoiceUpload);

        const setupVoiceTrigger = $('setup-voice-trigger');
        if (setupVoiceTrigger) setupVoiceTrigger.addEventListener('click', () => $('setup-voice-input').click());

        const setupBtnNext = $('setup-btn-next');
        if (setupBtnNext) setupBtnNext.addEventListener('click', setupGoToVoice);

        const setupBtnFinish = $('setup-btn-finish');
        if (setupBtnFinish) setupBtnFinish.addEventListener('click', finishSetup);

        const setupBtnSkip = $('setup-btn-skip');
        if (setupBtnSkip) setupBtnSkip.addEventListener('click', async () => {
            // 跳过语音，直接保存背景并进入
            if (!window._setupPendingBg) { notify('请先上传背景', 'warning'); return; }
            const bg = { id: generateId(), ...window._setupPendingBg, addedAt: Date.now() };
            companionData.backgrounds[currentMode].push(bg);
            await saveCompanionData();
            closeSetupModal();
            openTimeModal(currentMode);
        });

        const setupBtnCancel = $('setup-btn-cancel');
        if (setupBtnCancel) setupBtnCancel.addEventListener('click', closeSetupModal);

        // 时间选择弹窗
        const timeModal = $('time-modal');
        if (timeModal) {
            timeModal.addEventListener('click', e => {
                if (e.target === timeModal) closeTimeModal();
            });
        }
        const timeModalClose = $('time-modal-close');
        if (timeModalClose) timeModalClose.addEventListener('click', closeTimeModal);

        // 陪伴页
        const page = $('companion-page');
        if (page) page.addEventListener('click', handlePageClick);

        const exitBtn = $('companion-exit-btn');
        if (exitBtn) exitBtn.addEventListener('click', showExitConfirm);

        const settingsBtn = $('companion-settings-btn');
        if (settingsBtn) settingsBtn.addEventListener('click', e => { e.stopPropagation(); openSettingsPanel(); });

        const exitConfirmYes = $('exit-confirm-yes');
        if (exitConfirmYes) exitConfirmYes.addEventListener('click', closeCompanionPage);

        const exitConfirmNo = $('exit-confirm-no');
        if (exitConfirmNo) exitConfirmNo.addEventListener('click', hideExitConfirm);

        // 设置面板
        const panelClose = $('panel-close-btn');
        if (panelClose) panelClose.addEventListener('click', e => { e.stopPropagation(); closeSettingsPanel(); });

        const panelBgInput = $('panel-bg-input');
        if (panelBgInput) panelBgInput.addEventListener('change', handlePanelBgUpload);

        const panelBgTrigger = $('panel-bg-trigger');
        if (panelBgTrigger) panelBgTrigger.addEventListener('click', e => { e.stopPropagation(); $('panel-bg-input').click(); });

        const panelVoiceInput = $('panel-voice-input');
        if (panelVoiceInput) panelVoiceInput.addEventListener('change', handlePanelVoiceUpload);

        const panelVoiceTrigger = $('panel-voice-trigger');
        if (panelVoiceTrigger) panelVoiceTrigger.addEventListener('click', e => { e.stopPropagation(); $('panel-voice-input').click(); });
    }

    // ─── 入口 ────────────────────────────────────────────────────────────────

    let dataLoaded = false;

    // 等待 SESSION_ID 就绪（最多等 10 秒）
    async function waitForSession(maxWait = 10000) {
        const start = Date.now();
        while (Date.now() - start < maxWait) {
            if (typeof window.SESSION_ID !== 'undefined' && window.SESSION_ID) return true;
            await new Promise(r => setTimeout(r, 200));
        }
        return false;
    }

    // 懒加载数据：在用户首次打开陪伴功能时才加载
    async function ensureDataLoaded() {
        if (dataLoaded) return true;
        const ready = await waitForSession();
        if (!ready) {
            notify('系统还在初始化，请稍后再试', 'warning');
            return false;
        }
        await loadCompanionData();
        dataLoaded = true;
        return true;
    }

    // 用户点击顶部"陪伴"按钮的真正入口
    async function handleEntryClick() {
        const ok = await ensureDataLoaded();
        if (!ok) return;
        openCompanionModal();
    }

    async function init() {
        try {
            // 先绑定事件，这样按钮立刻可用
            bindEvents();
            console.log('[companion] 模块加载完成（数据将在首次使用时加载）');
        } catch (e) {
            console.error('[companion] 初始化失败，已跳过陪伴模块以保护主功能', e);
        }
    }

    // 等 DOM 就绪
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        setTimeout(init, 0);
    }

    // 暴露给外部（可选）
    window.companionModule = { openCompanionModal, closeCompanionPage };

})();
