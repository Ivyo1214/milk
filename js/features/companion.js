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
        // 先移除可能残留的旧弹窗
        const existing = document.getElementById('companion-modal-dynamic');
        if (existing) existing.remove();

        // 动态创建弹窗，用内联样式强制覆盖，避免被原项目的 hideModal 干扰
        // 注意：内层不再用 .modal-content（避免被 hideModal querySelector 抓到）
        const modal = document.createElement('div');
        modal.id = 'companion-modal-dynamic';
        modal.setAttribute('style', [
            'position:fixed', 'inset:0', 'z-index:99998',
            'background:rgba(0,0,0,0.5)',
            'display:flex', 'align-items:center', 'justify-content:center',
            'opacity:1', 'pointer-events:all',
            'animation:companionFadeIn 0.25s ease'
        ].join(';'));

        modal.innerHTML = `
            <div id="companion-modal-card" style="
                background:#fff;border-radius:20px;padding:28px 24px 20px;
                width:min(92vw, 420px);max-height:85vh;overflow-y:auto;
                box-shadow:0 20px 60px rgba(0,0,0,0.18);
                opacity:1 !important;transform:none !important;
                animation:companionPopIn 0.3s cubic-bezier(0.34,1.56,0.64,1);
            ">
                <div style="display:flex;align-items:center;gap:8px;font-size:18px;font-weight:600;color:#1a1a1a;margin-bottom:18px;justify-content:center;">
                    <i class="fas fa-hand-holding-heart" style="color:#c5a47e;"></i>
                    <span>陪伴</span>
                </div>
                <div id="companion-cards-wrap" style="display:grid;grid-template-columns:repeat(2,1fr);gap:14px;padding:6px 4px;">
                    ${Object.entries(MODES).map(([key, cfg]) => `
                        <div class="companion-mode-card-dyn" data-mode="${key}" style="
                            background:#fafafa;border-radius:14px;padding:22px 12px;cursor:pointer;
                            border:1px solid rgba(0,0,0,0.06);
                            display:flex;flex-direction:column;align-items:center;gap:10px;
                            transition:all 0.25s ease;user-select:none;
                        ">
                            <div style="
                                width:56px;height:56px;border-radius:50%;
                                background:rgba(197,164,126,0.12);
                                display:flex;align-items:center;justify-content:center;
                            ">
                                <i class="fas ${cfg.icon}" style="font-size:24px;color:#c5a47e;"></i>
                            </div>
                            <span style="font-size:14px;font-weight:600;color:#1a1a1a;">${cfg.label}</span>
                        </div>
                    `).join('')}
                </div>
                <div style="margin-top:18px;text-align:right;">
                    <button id="companion-dynamic-close" style="
                        padding:8px 20px;border-radius:10px;border:1px solid rgba(0,0,0,0.1);
                        background:#f5f5f5;color:#666;font-size:13px;cursor:pointer;
                    ">关闭</button>
                </div>
            </div>
        `;

        // 点遮罩关闭
        modal.addEventListener('click', e => {
            if (e.target === modal) closeCompanionModal();
        });

        // 关闭按钮
        modal.querySelector('#companion-dynamic-close').addEventListener('click', closeCompanionModal);

        // 点卡片
        modal.querySelectorAll('.companion-mode-card-dyn').forEach(card => {
            card.addEventListener('click', e => {
                e.stopPropagation();
                selectMode(card.dataset.mode);
            });
            // hover 效果（用 JS 因为内联样式没法用 :hover）
            card.addEventListener('mouseenter', () => {
                card.style.transform = 'translateY(-3px)';
                card.style.borderColor = '#c5a47e';
                card.style.boxShadow = '0 10px 24px rgba(0,0,0,0.08)';
            });
            card.addEventListener('mouseleave', () => {
                card.style.transform = '';
                card.style.borderColor = 'rgba(0,0,0,0.06)';
                card.style.boxShadow = '';
            });
        });

        // 注入动画 keyframes（一次性）
        if (!document.getElementById('companion-keyframes')) {
            const style = document.createElement('style');
            style.id = 'companion-keyframes';
            style.textContent = `
                @keyframes companionFadeIn { from { opacity: 0; } to { opacity: 1; } }
                @keyframes companionPopIn { from { opacity: 0; transform: scale(0.94) translateY(10px); } to { opacity: 1; transform: scale(1) translateY(0); } }
            `;
            document.head.appendChild(style);
        }

        document.documentElement.appendChild(modal);
        console.log('[companion] 弹窗已创建并挂到 documentElement');
    }

    function closeCompanionModal() {
        // 清理所有可能的弹窗实例（防止守护残留）
        document.querySelectorAll('#companion-modal-dynamic').forEach(el => el.remove());
        // 兼容旧的静态弹窗
        const oldModal = document.getElementById('companion-modal');
        if (oldModal) oldModal.classList.remove('active');
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

    // 动态创建设置弹窗的通用容器
    function _createDynamicModal(id, contentHtml) {
        // 移除残留
        const existing = document.getElementById(id);
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = id;
        modal.setAttribute('style', [
            'position:fixed', 'inset:0', 'z-index:99998',
            'background:rgba(0,0,0,0.5)',
            'display:flex', 'align-items:center', 'justify-content:center',
            'opacity:1', 'pointer-events:all',
            'animation:companionFadeIn 0.25s ease'
        ].join(';'));

        modal.innerHTML = `
            <div style="
                background:#fff;border-radius:20px;padding:28px 24px 20px;
                width:min(92vw, 460px);max-height:85vh;overflow-y:auto;
                box-shadow:0 20px 60px rgba(0,0,0,0.18);
                animation:companionPopIn 0.3s cubic-bezier(0.34,1.56,0.64,1);
            ">${contentHtml}</div>
        `;
        document.documentElement.appendChild(modal);
        return modal;
    }

    function openSetupModal(mode) {
        const cfg = MODES[mode];
        window._setupPendingBg = null;
        window._setupPendingVoices = [];

        const html = `
            <div style="display:flex;align-items:center;gap:8px;font-size:18px;font-weight:600;color:#1a1a1a;margin-bottom:14px;justify-content:center;">
                <i class="fas ${cfg.icon}" style="color:#c5a47e;"></i>
                <span>${cfg.label}</span>
            </div>
            <div id="setup-dyn-step-bg">
                <p style="font-size:13px;color:#888;text-align:center;margin:6px 0 16px;line-height:1.6;">请上传一张梦角的图片或视频，作为陪伴背景 ✦</p>
                <div id="setup-dyn-bg-preview" style="display:none;width:100%;height:160px;border-radius:12px;overflow:hidden;margin-bottom:12px;background:#000;"></div>
                <div id="setup-dyn-bg-trigger" style="
                    border:2px dashed rgba(197,164,126,0.5);border-radius:14px;padding:24px 16px;
                    display:flex;flex-direction:column;align-items:center;gap:8px;cursor:pointer;
                    background:rgba(197,164,126,0.04);transition:all 0.2s ease;
                ">
                    <i class="fas fa-cloud-arrow-up" style="font-size:28px;color:#c5a47e;"></i>
                    <span style="font-size:14px;font-weight:600;color:#1a1a1a;">点击上传图片 / 视频</span>
                    <small style="font-size:11px;color:#888;">支持 jpg · png · gif · mp4 · mov，建议 ≤ 100MB</small>
                </div>
                <input type="file" id="setup-dyn-bg-input" accept="image/*,video/*" style="display:none">
                <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px;">
                    <button id="setup-dyn-btn-cancel" style="padding:8px 20px;border-radius:10px;border:1px solid rgba(0,0,0,0.1);background:#f5f5f5;color:#666;font-size:13px;cursor:pointer;">取消</button>
                    <button id="setup-dyn-btn-next" style="display:none;padding:8px 20px;border-radius:10px;border:none;background:#c5a47e;color:#fff;font-size:13px;cursor:pointer;">下一步 →</button>
                </div>
            </div>
            <div id="setup-dyn-step-voice" style="display:none;">
                <p style="font-size:13px;color:#888;text-align:center;margin:6px 0 16px;line-height:1.6;">上传梦角的语音，点击屏幕时会随机播放 ✦</p>
                <div id="setup-dyn-voice-trigger" style="
                    border:2px dashed rgba(197,164,126,0.5);border-radius:14px;padding:14px 16px;
                    display:flex;flex-direction:column;align-items:center;gap:6px;cursor:pointer;
                    background:rgba(197,164,126,0.04);transition:all 0.2s ease;
                ">
                    <i class="fas fa-microphone" style="font-size:20px;color:#c5a47e;"></i>
                    <span style="font-size:13px;font-weight:600;color:#1a1a1a;">点击上传语音</span>
                    <small style="font-size:11px;color:#888;">支持 mp3 · m4a · wav，可多选</small>
                </div>
                <input type="file" id="setup-dyn-voice-input" accept="audio/*" multiple style="display:none">
                <div id="setup-dyn-voice-list" style="margin-top:10px;display:flex;flex-direction:column;gap:8px;max-height:200px;overflow-y:auto;"></div>
                <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px;">
                    <button id="setup-dyn-btn-skip" style="padding:8px 20px;border-radius:10px;border:1px solid rgba(0,0,0,0.1);background:#f5f5f5;color:#666;font-size:13px;cursor:pointer;">跳过</button>
                    <button id="setup-dyn-btn-finish" style="padding:8px 20px;border-radius:10px;border:none;background:#c5a47e;color:#fff;font-size:13px;cursor:pointer;">✓ 完成</button>
                </div>
            </div>
        `;

        const modal = _createDynamicModal('setup-modal-dynamic', html);

        // 点遮罩关闭
        modal.addEventListener('click', e => {
            if (e.target === modal) closeSetupModalDyn();
        });

        // 背景上传触发
        modal.querySelector('#setup-dyn-bg-trigger').addEventListener('click', () => {
            modal.querySelector('#setup-dyn-bg-input').click();
        });

        // 背景文件选择
        modal.querySelector('#setup-dyn-bg-input').addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const isVideo = file.type.startsWith('video/');
            const isImage = file.type.startsWith('image/');
            if (!isVideo && !isImage) { notify('请上传图片或视频文件', 'error'); return; }
            if (file.size > 100 * 1024 * 1024) notify('文件超过 100MB，加载可能较慢', 'warning');

            notify('正在处理文件...', 'info');
            const base64 = await readFileAsBase64(file);
            window._setupPendingBg = { type: isVideo ? 'video' : 'image', data: base64, name: file.name };

            const preview = modal.querySelector('#setup-dyn-bg-preview');
            preview.innerHTML = '';
            if (isVideo) {
                const v = document.createElement('video');
                v.src = base64; v.muted = true; v.autoplay = true; v.loop = true; v.playsInline = true;
                v.style.cssText = 'width:100%;height:100%;object-fit:cover;';
                preview.appendChild(v);
            } else {
                const img = document.createElement('img');
                img.src = base64;
                img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
                preview.appendChild(img);
            }
            preview.style.display = 'block';
            modal.querySelector('#setup-dyn-btn-next').style.display = 'inline-flex';
            e.target.value = '';
        });

        // 取消按钮
        modal.querySelector('#setup-dyn-btn-cancel').addEventListener('click', closeSetupModalDyn);

        // 下一步：跳到语音步骤
        modal.querySelector('#setup-dyn-btn-next').addEventListener('click', () => {
            if (!window._setupPendingBg) { notify('请先上传背景', 'warning'); return; }
            modal.querySelector('#setup-dyn-step-bg').style.display = 'none';
            modal.querySelector('#setup-dyn-step-voice').style.display = 'block';
        });

        // 语音上传触发
        modal.querySelector('#setup-dyn-voice-trigger').addEventListener('click', () => {
            modal.querySelector('#setup-dyn-voice-input').click();
        });

        // 语音文件选择
        modal.querySelector('#setup-dyn-voice-input').addEventListener('change', async (e) => {
            const files = Array.from(e.target.files);
            for (const file of files) {
                if (!file.type.startsWith('audio/')) { notify(`${file.name} 不是音频文件，已跳过`, 'warning'); continue; }
                const base64 = await readFileAsBase64(file);
                window._setupPendingVoices.push({
                    id: generateId(), data: base64,
                    name: file.name.replace(/\.[^/.]+$/, ''),
                    addedAt: Date.now()
                });
            }
            renderSetupVoiceListDyn(modal);
            e.target.value = '';
        });

        // 跳过：保存背景直接进入时间选择
        modal.querySelector('#setup-dyn-btn-skip').addEventListener('click', async () => {
            if (!window._setupPendingBg) { notify('请先上传背景', 'warning'); return; }
            const bg = { id: generateId(), ...window._setupPendingBg, addedAt: Date.now() };
            companionData.backgrounds[currentMode].push(bg);
            await saveCompanionData();
            closeSetupModalDyn();
            openTimeModal(currentMode);
        });

        // 完成：保存全部
        modal.querySelector('#setup-dyn-btn-finish').addEventListener('click', async () => {
            if (!window._setupPendingBg) { notify('请先上传背景图片或视频', 'warning'); return; }
            const bg = { id: generateId(), ...window._setupPendingBg, addedAt: Date.now() };
            companionData.backgrounds[currentMode].push(bg);
            if (window._setupPendingVoices && window._setupPendingVoices.length) {
                companionData.voices.push(...window._setupPendingVoices);
            }
            await saveCompanionData();
            closeSetupModalDyn();
            notify('设置完成！', 'success');
            openTimeModal(currentMode);
        });

        console.log('[companion] 设置弹窗已打开');
    }

    function closeSetupModalDyn() {
        document.querySelectorAll('#setup-modal-dynamic').forEach(el => el.remove());
        window._setupPendingBg = null;
        window._setupPendingVoices = [];
    }

    function renderSetupVoiceListDyn(modal) {
        const list = modal.querySelector('#setup-dyn-voice-list');
        const voices = window._setupPendingVoices || [];
        if (!voices.length) {
            list.innerHTML = '<p style="font-size:12px;color:#888;text-align:center;padding:8px 0;">暂无语音，可跳过</p>';
            return;
        }
        list.innerHTML = voices.map((v, i) => `
            <div style="display:flex;align-items:center;gap:8px;background:rgba(197,164,126,0.07);border-radius:10px;padding:8px 10px;">
                <i class="fas fa-music" style="color:#c5a47e;font-size:14px;"></i>
                <input type="text" value="${v.name}" data-idx="${i}" class="setup-dyn-voice-name"
                    style="flex:1;border:none;background:transparent;font-size:13px;outline:none;min-width:0;">
                <button data-id="${v.id}" class="setup-dyn-voice-del"
                    style="background:none;border:none;cursor:pointer;padding:4px 6px;border-radius:6px;color:#888;">
                    <i class="fas fa-trash-can"></i>
                </button>
            </div>
        `).join('');

        list.querySelectorAll('.setup-dyn-voice-name').forEach(inp => {
            inp.addEventListener('change', e => {
                const idx = parseInt(e.target.dataset.idx);
                if (window._setupPendingVoices[idx]) window._setupPendingVoices[idx].name = e.target.value;
            });
        });
        list.querySelectorAll('.setup-dyn-voice-del').forEach(btn => {
            btn.addEventListener('click', e => {
                const id = e.currentTarget.dataset.id;
                window._setupPendingVoices = window._setupPendingVoices.filter(v => v.id !== id);
                renderSetupVoiceListDyn(modal);
            });
        });
    }

    function closeSetupModal() {
        closeSetupModalDyn();
        const oldSetup = document.getElementById('setup-modal');
        if (oldSetup) oldSetup.classList.remove('active');
    }


    // ─── 时间选择弹窗 ────────────────────────────────────────────────────────

    function openTimeModal(mode) {
        const cfg = MODES[mode];

        const timesHtml = cfg.times.map(t => {
            if (t === 'rest') {
                return `<button class="time-btn-dyn" data-time="rest" style="
                    background:#fff;border:1.5px solid #eee;border-radius:14px;padding:16px 8px;cursor:pointer;
                    display:flex;flex-direction:column;align-items:center;gap:4px;transition:all 0.2s ease;
                ">
                    <i class="fas fa-cloud-moon" style="font-size:20px;color:#c5a47e;"></i>
                    <span style="font-size:13px;font-weight:600;color:#1a1a1a;">好好休息</span>
                </button>`;
            }
            return `<button class="time-btn-dyn" data-time="${t}" style="
                background:#fff;border:1.5px solid #eee;border-radius:14px;padding:16px 8px;cursor:pointer;
                display:flex;flex-direction:column;align-items:center;gap:4px;transition:all 0.2s ease;
            ">
                <span style="font-size:22px;font-weight:700;color:#c5a47e;line-height:1;">${t}</span>
                <span style="font-size:11px;color:#888;">分钟</span>
            </button>`;
        }).join('');

        const html = `
            <div style="display:flex;align-items:center;gap:8px;font-size:18px;font-weight:600;color:#1a1a1a;margin-bottom:10px;justify-content:center;">
                <i class="fas ${cfg.icon}" style="color:#c5a47e;"></i>
                <span>${cfg.label}</span>
            </div>
            <p style="font-size:13px;color:#888;text-align:center;margin:6px 0 16px;">选择本次陪伴时长</p>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:10px 0 18px;">${timesHtml}</div>
            <div style="margin-top:18px;text-align:right;">
                <button id="time-dyn-close" style="
                    padding:8px 20px;border-radius:10px;border:1px solid rgba(0,0,0,0.1);
                    background:#f5f5f5;color:#666;font-size:13px;cursor:pointer;
                ">取消</button>
            </div>
        `;

        const modal = _createDynamicModal('time-modal-dynamic', html);

        modal.addEventListener('click', e => {
            if (e.target === modal) closeTimeModalDyn();
        });

        modal.querySelector('#time-dyn-close').addEventListener('click', closeTimeModalDyn);

        modal.querySelectorAll('.time-btn-dyn').forEach(btn => {
            btn.addEventListener('click', () => {
                const t = btn.dataset.time;
                closeTimeModalDyn();
                if (t === 'rest') {
                    isCountdown = false;
                    timerSeconds = 0;
                    totalSeconds = 0;
                } else {
                    isCountdown = true;
                    timerSeconds = parseInt(t) * 60;
                    totalSeconds = parseInt(t) * 60;
                }
                openCompanionPage();
            });
            btn.addEventListener('mouseenter', () => {
                btn.style.borderColor = '#c5a47e';
                btn.style.background = 'rgba(197,164,126,0.08)';
                btn.style.transform = 'translateY(-2px)';
            });
            btn.addEventListener('mouseleave', () => {
                btn.style.borderColor = '#eee';
                btn.style.background = '#fff';
                btn.style.transform = '';
            });
        });

        console.log('[companion] 时间选择弹窗已打开');
    }

    function closeTimeModalDyn() {
        document.querySelectorAll('#time-modal-dynamic').forEach(el => el.remove());
    }

    function closeTimeModal() {
        closeTimeModalDyn();
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

        if (!page) {
            notify('陪伴页面加载失败，请刷新页面重试', 'error');
            console.error('[companion] companion-page 元素不存在！');
            return;
        }

        // 设置背景
        const bgs = companionData.backgrounds[currentMode];
        const bg = bgs[Math.floor(Math.random() * bgs.length)];
        renderCompanionBackground(bg);

        // 设置提示文字
        const hint = $('companion-hint-text');
        if (hint) hint.textContent = cfg.hint;

        // 初始化计时器显示
        updateTimerDisplay();

        // 显示页面
        page.classList.add('active');
        document.body.style.overflow = 'hidden';

        // 启动计时器
        startTimer();
        console.log('[companion] 陪伴页面已打开');
    }

    function renderCompanionBackground(bg) {
        const container = $('companion-bg-container');
        if (!container) return;
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
        // 顶部按钮 —— 用事件委托，无论按钮何时出现都能响应
        document.addEventListener('click', function (e) {
            const btn = e.target.closest && e.target.closest('#companion-btn');
            if (btn) {
                e.stopPropagation();
                e.preventDefault();
                console.log('[companion] 陪伴按钮被点击');
                handleEntryClick();
            }
        }, true); // 用捕获阶段，确保抢在其他监听器之前

        // 陪伴模式卡片 —— 用 data-mode 属性识别（class 可能被原项目清理）
        document.addEventListener('click', function (e) {
            const card = e.target.closest && e.target.closest('[data-mode]');
            if (card && card.closest && card.closest('#companion-modal')) {
                e.stopPropagation();
                e.preventDefault();
                selectMode(card.dataset.mode);
            }
        }, true);

        // 陪伴选择弹窗（点击遮罩关闭）
        const modal = $('companion-modal');
        if (modal) {
            modal.addEventListener('click', e => {
                if (e.target === modal) closeCompanionModal();
            });
        }
        const closeModalBtn = $('companion-modal-close');
        if (closeModalBtn) closeModalBtn.addEventListener('click', closeCompanionModal);

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
    function isSessionReady() {
        try {
            // 直接尝试访问全局 SESSION_ID（原项目用 const 声明，不在 window 上）
            // 用 Function 构造器避免 strict mode 的影响
            const sid = (new Function('try { return typeof SESSION_ID !== "undefined" ? SESSION_ID : null; } catch(e) { return null; }'))();
            return !!sid;
        } catch (e) {
            return false;
        }
    }

    async function waitForSession(maxWait = 10000) {
        const start = Date.now();
        while (Date.now() - start < maxWait) {
            if (isSessionReady()) return true;
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
