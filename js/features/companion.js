/**
 * companion.js — 陪伴功能模块
 * 依赖：localforage, APP_PREFIX, getStorageKey, showNotification
 */

(function () {
    'use strict';

    // ─── 常量 ────────────────────────────────────────────────────────────────

    const STORAGE_KEY = 'companionData';

    const MODES = {
        study:    {
            label: '一起学习',
            icon:  'fa-book-open',
            hint:  '正在一起学习 · 加油',
            times: [5,10,15,20,25,30],          // 用户可选
            inviteTimes: [15, 20, 25],          // 梦角主动邀请时随机选
        },
        work:     {
            label: '一起工作',
            icon:  'fa-laptop-code',
            hint:  '正在一起工作 · 专注中',
            times: [5,10,15,20,25,30],
            inviteTimes: [15, 20, 25, 30],
        },
        exercise: {
            label: '一起运动',
            icon:  'fa-person-running',
            hint:  '正在一起运动 · 不要偷懒哦',
            times: [5,10,15,20,25,30],
            inviteTimes: [10, 15, 20],
        },
        sleep:    {
            label: '一起睡觉',
            icon:  'fa-moon',
            hint:  '闭上眼睛 · 我就在旁边',
            times: [10,20,30,60,'rest'],
            inviteTimes: [30, 60, 'rest'],
        },
    };

    // ─── 运行时状态 ──────────────────────────────────────────────────────────

    let companionData = {
        backgrounds: { study: [], work: [], exercise: [], sleep: [] },
        voices:      { study: [], work: [], exercise: [], sleep: [] },
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

    function _emptyData() {
        return {
            backgrounds: { study: [], work: [], exercise: [], sleep: [] },
            voices:      { study: [], work: [], exercise: [], sleep: [] },
            history: []
        };
    }

    async function loadCompanionData() {
        try {
            const key = typeof getStorageKey === 'function'
                ? getStorageKey(STORAGE_KEY)
                : (window.APP_PREFIX || 'CHAT_APP_V3_') + STORAGE_KEY;
            const saved = await localforage.getItem(key);
            if (saved) {
                companionData = Object.assign(_emptyData(), saved);
                // 确保每个场景的 backgrounds 数组存在
                for (const m of Object.keys(MODES)) {
                    if (!companionData.backgrounds[m]) companionData.backgrounds[m] = [];
                }
                // ── 数据迁移：voices 之前是数组（全局共享），现在改成按场景分的对象 ──
                if (Array.isArray(companionData.voices)) {
                    const oldVoices = companionData.voices;
                    companionData.voices = { study: [], work: [], exercise: [], sleep: [] };
                    if (oldVoices.length > 0) {
                        // 旧数据复制到所有场景（不丢失，但用户可以后续去删除）
                        for (const m of Object.keys(MODES)) {
                            companionData.voices[m] = oldVoices.map(v => ({ ...v }));
                        }
                        console.log('[companion] 检测到旧的全局语音库，已迁移到 4 个场景');
                    }
                }
                // 确保每个场景的 voices 数组存在
                if (typeof companionData.voices !== 'object' || Array.isArray(companionData.voices)) {
                    companionData.voices = { study: [], work: [], exercise: [], sleep: [] };
                }
                for (const m of Object.keys(MODES)) {
                    if (!companionData.voices[m]) companionData.voices[m] = [];
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
        injectKeyframes();

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

    // ─── 工具：获取梦角信息 + 发送聊天事件（复用通话的接口） ─────────────────

    function getPartnerName() {
        return window.settings?.partnerName ||
            document.getElementById('partner-name')?.textContent.trim() ||
            '梦角';
    }

    function getMyName() {
        return window.settings?.myName || '我';
    }

    function getPartnerAvatarSrc() {
        const img = document.querySelector('#partner-avatar img,[id*="partner-avatar"] img,.partner-avatar img');
        return img ? img.src : null;
    }

    function sendChatEvent(icon, label, detail) {
        // 复用原项目通话事件的接口，往聊天里加一条记录
        if (typeof window._addCallEvent === 'function') {
            window._addCallEvent(icon, label, detail);
        } else {
            let tries = 0;
            const t = setInterval(() => {
                if (typeof window._addCallEvent === 'function') {
                    clearInterval(t);
                    window._addCallEvent(icon, label, detail);
                }
                if (++tries > 25) clearInterval(t);
            }, 200);
        }
    }

    // ─── 内置台词库 ────────────────────────────────────────────────────────

    const REJECT_LINES = [
        '现在有点事，下次吧',
        '等我一会儿，现在不行',
        '抱歉，现在没空',
        '还在忙，晚点再说',
        '现在不方便',
    ];

    // 梦角主动邀请的台词（按场景区分）
    const INVITE_LINES = {
        study: ['要一起学习吗？', '陪你看会儿书？', '一起努力吧，我陪你'],
        work:  ['在忙吗？我陪你工作', '一起加油干活吧', '陪你度过这段时间'],
        exercise: ['动一动吧，我陪你', '一起活动一下？', '该锻炼了，我陪着你'],
        sleep: ['该休息了，陪你睡', '困了吗？我陪你', '一起入睡吧'],
    };

    function pickRandom(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    }

    // ─── 选择场景后：加入"邀请中"等待 + 概率拒绝 ──────────────────────────────

    // 强制结果（用于测试）：null=正常随机，'accept'=强制同意，'reject'=强制拒绝
    let _forceResult = null;

    // 用户点场景卡 → 先让用户选时间 → 选完后再发起邀请
    async function selectMode(mode) {
        currentMode = mode;
        closeCompanionModal();
        // 打开时间选择，用户选完后再走邀请等待流程
        openTimeModal(mode, (selectedTime) => {
            // 时间已经在 openTimeModal 内部设置好（isCountdown/timerSeconds/totalSeconds）
            // 这里只需要发起邀请
            showCompanionInviting(mode);
        });
    }

    // 用户发起接受 → 直接进陪伴页（时间已经在选场景前就选好了）
    function enterAfterUserAccepted() {
        // 时间状态已经在 selectMode → openTimeModal 阶段就 ready 了
        openCompanionPage();
    }

    // 梦角发起接受 → 直接进入陪伴页（用梦角说的那个时间）
    function enterWithInviteTime(mode, time) {
        currentMode = mode;
        // 设置时间状态（和 openTimeModal 里点按钮后的逻辑一致）
        if (time === 'rest') {
            isCountdown = false;
            timerSeconds = 0;
            totalSeconds = 0;
        } else {
            isCountdown = true;
            timerSeconds = parseInt(time) * 60;
            totalSeconds = parseInt(time) * 60;
        }
        openCompanionPage();
    }

    // ─── 邀请等待 UI（用户发起后显示）─────────────────────────────────────

    function showCompanionInviting(mode) {
        const cfg = MODES[mode];
        const partnerName = getPartnerName();
        const avSrc = getPartnerAvatarSrc();

        // 计算用户已选的时间文本（用于显示在副标题里，让用户知道梦角看到的邀请内容）
        let userTimeText;
        if (!isCountdown) {
            userTimeText = '好好休息';
        } else {
            const minutes = Math.round(totalSeconds / 60);
            userTimeText = `${minutes} 分钟`;
        }

        // 移除残留
        document.querySelectorAll('#companion-inviting-overlay').forEach(el => el.remove());

        const overlay = document.createElement('div');
        overlay.id = 'companion-inviting-overlay';
        overlay.setAttribute('style', [
            'position:fixed', 'inset:0', 'z-index:99998',
            'background:rgba(15,15,20,0.92)',
            'display:flex', 'align-items:center', 'justify-content:center',
            'animation:companionFadeIn 0.3s ease',
        ].join(';'));

        const avatarHtml = avSrc
            ? `<img src="${avSrc}" style="width:100%;height:100%;object-fit:cover;">`
            : `<i class="fas fa-user" style="font-size:34px;color:rgba(255,255,255,.85);"></i>`;

        overlay.innerHTML = `
            <div style="
                display:flex;flex-direction:column;align-items:center;gap:18px;
                color:#fff;animation:companionPopIn 0.4s ease;
            ">
                <div style="position:relative;width:96px;height:96px;">
                    <div style="
                        position:absolute;inset:-6px;border-radius:50%;
                        border:2px solid rgba(197,164,126,0.5);
                        animation:companionPulseRing 1.6s ease-out infinite;
                    "></div>
                    <div style="
                        position:absolute;inset:-14px;border-radius:50%;
                        border:2px solid rgba(197,164,126,0.3);
                        animation:companionPulseRing 1.6s ease-out infinite 0.5s;
                    "></div>
                    <div style="
                        width:96px;height:96px;border-radius:50%;overflow:hidden;
                        background:rgba(255,255,255,0.1);
                        display:flex;align-items:center;justify-content:center;
                        border:2px solid rgba(255,255,255,0.15);
                        position:relative;z-index:1;
                    ">${avatarHtml}</div>
                </div>
                <div style="font-size:20px;font-weight:600;letter-spacing:1px;">${partnerName}</div>
                <div style="font-size:13px;color:rgba(255,255,255,0.6);display:flex;align-items:center;gap:8px;">
                    <i class="fas ${cfg.icon}" style="color:#c5a47e;"></i>
                    <span>邀请${cfg.label} · ${userTimeText}</span>
                    <span class="inviting-dots" style="display:inline-flex;gap:3px;">
                        <span style="width:4px;height:4px;border-radius:50%;background:rgba(255,255,255,0.6);animation:companionDot 1.2s infinite;"></span>
                        <span style="width:4px;height:4px;border-radius:50%;background:rgba(255,255,255,0.6);animation:companionDot 1.2s infinite 0.2s;"></span>
                        <span style="width:4px;height:4px;border-radius:50%;background:rgba(255,255,255,0.6);animation:companionDot 1.2s infinite 0.4s;"></span>
                    </span>
                </div>
                <button id="companion-inviting-cancel" style="
                    margin-top:30px;width:64px;height:64px;border-radius:50%;border:none;
                    background:linear-gradient(135deg,#ff5252,#c62828);
                    color:#fff;font-size:22px;cursor:pointer;
                    box-shadow:0 6px 20px rgba(255,82,82,.45);
                    display:flex;align-items:center;justify-content:center;
                ">
                    <i class="fas fa-xmark"></i>
                </button>
                <div style="font-size:11px;color:rgba(255,255,255,0.35);">取消</div>
            </div>
        `;

        // 注入动画 keyframes
        injectKeyframes();

        // 给这次 invite 一个唯一 id，防止旧 timer 误操作新 overlay
        const sessionId = Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        overlay.dataset.sessionId = sessionId;

        document.documentElement.appendChild(overlay);

        // 取消按钮
        overlay.querySelector('#companion-inviting-cancel').addEventListener('click', () => {
            clearTimeout(window._invitingTimer);
            closeInviting();
            sendChatEvent('fa-circle-xmark', `取消了对${partnerName}的陪伴邀请`, null);
        });

        // 决定结果
        const rejectChance = 0.35;
        const willReject = _forceResult === 'reject'
            ? true
            : _forceResult === 'accept'
                ? false
                : Math.random() < rejectChance;

        // 检查 overlay 还是不是本次 session 的（防止用户取消又立刻再发起，旧 timer 误触新 overlay）
        const isStillThisSession = () => {
            const el = document.getElementById('companion-inviting-overlay');
            return el && el.dataset.sessionId === sessionId;
        };

        if (willReject) {
            // 4~12 秒后拒绝
            const delay = 4000 + Math.random() * 8000;
            window._invitingTimer = setTimeout(() => {
                if (!isStillThisSession()) return;
                closeInviting();
                const line = pickRandom(REJECT_LINES);
                sendChatEvent('fa-heart-crack', `${partnerName}：${line}`, null);
                if (typeof showNotification === 'function') {
                    showNotification(`${partnerName} 拒绝了陪伴邀请`, 'info');
                }
            }, delay);
        } else {
            // 1~3 秒后接受
            const delay = 1000 + Math.random() * 2000;
            window._invitingTimer = setTimeout(() => {
                if (!isStillThisSession()) return;
                closeInviting();
                sendChatEvent('fa-heart', `${partnerName}同意了一起陪伴`, null);
                enterAfterUserAccepted();
            }, delay);
        }
    }

    function closeInviting() {
        document.querySelectorAll('#companion-inviting-overlay').forEach(el => el.remove());
        clearTimeout(window._invitingTimer);
    }

    // ─── 梦角主动邀请 UI ────────────────────────────────────────────────────

    async function showIncomingCompanion(mode) {
        // 确保数据已加载（梦角主动邀请触发时数据可能还没加载）
        const ok = await ensureDataLoaded();
        if (!ok) return;

        // 如果当前已经在陪伴中或有其他陪伴弹窗在，跳过
        if (document.getElementById('companion-page')?.classList.contains('active')) return;
        if (document.querySelector('#companion-inviting-overlay, #companion-incoming-overlay, #companion-modal-dynamic, #setup-modal-dynamic, #time-modal-dynamic')) return;

        // 如果没指定 mode，随机选一个
        if (!mode) {
            const modes = Object.keys(MODES);
            mode = modes[Math.floor(Math.random() * modes.length)];
        }
        currentMode = mode;
        const cfg = MODES[mode];
        const partnerName = getPartnerName();
        const avSrc = getPartnerAvatarSrc();
        const baseLine = pickRandom(INVITE_LINES[mode] || INVITE_LINES.study);

        // 梦角自选时间（从 inviteTimes 池里随机选一个）
        const inviteTime = pickRandom(cfg.inviteTimes || [25]);

        // 拼接邀请文案：智能处理"陪你"是否已经在台词里 + rest 特殊处理
        let line;
        if (inviteTime === 'rest') {
            // 睡觉的"好好休息"模式：单独一句更自然
            line = '陪你一起睡到自然醒吧';
        } else {
            const timeText = `${inviteTime} 分钟`;
            // 台词里已经有"陪你"/"陪着你" → 直接加时间
            // 没有 → 末尾是问号/感叹号则直接加" 陪你 XX"，否则加"，陪你 XX"
            if (/陪你|陪着你/.test(baseLine)) {
                line = `${baseLine} ${timeText}`;
            } else if (/[？！?!]$/.test(baseLine)) {
                line = `${baseLine} 陪你 ${timeText}`;
            } else {
                line = `${baseLine}，陪你 ${timeText}`;
            }
        }

        // 移除残留
        document.querySelectorAll('#companion-incoming-overlay').forEach(el => el.remove());

        const overlay = document.createElement('div');
        overlay.id = 'companion-incoming-overlay';
        // 把时间存到 dataset 上，接受按钮可以拿到
        overlay.dataset.inviteTime = inviteTime;
        overlay.dataset.inviteMode = mode;
        overlay.setAttribute('style', [
            'position:fixed', 'inset:0', 'z-index:99998',
            'background:rgba(15,15,20,0.95)',
            'display:flex', 'align-items:center', 'justify-content:center',
            'animation:companionFadeIn 0.35s ease',
        ].join(';'));

        const avatarHtml = avSrc
            ? `<img src="${avSrc}" style="width:100%;height:100%;object-fit:cover;">`
            : `<i class="fas fa-user" style="font-size:34px;color:rgba(255,255,255,.85);"></i>`;

        overlay.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;gap:18px;color:#fff;">
                <div style="position:relative;width:96px;height:96px;">
                    <div style="position:absolute;inset:-6px;border-radius:50%;border:2px solid rgba(197,164,126,0.5);animation:companionPulseRing 1.6s ease-out infinite;"></div>
                    <div style="position:absolute;inset:-14px;border-radius:50%;border:2px solid rgba(197,164,126,0.3);animation:companionPulseRing 1.6s ease-out infinite 0.5s;"></div>
                    <div style="
                        width:96px;height:96px;border-radius:50%;overflow:hidden;
                        background:rgba(255,255,255,0.1);
                        display:flex;align-items:center;justify-content:center;
                        border:2px solid rgba(255,255,255,0.15);
                        position:relative;z-index:1;
                    ">${avatarHtml}</div>
                </div>
                <div style="font-size:20px;font-weight:600;letter-spacing:1px;">${partnerName}</div>
                <div style="font-size:12px;color:rgba(255,255,255,0.5);display:flex;align-items:center;gap:6px;">
                    <span style="width:6px;height:6px;border-radius:50%;background:#c5a47e;animation:companionDot 1.1s step-end infinite;"></span>
                    <span>想和你一起...</span>
                </div>
                <div style="
                    background:rgba(255,255,255,0.08);border-radius:14px;padding:12px 20px;
                    display:flex;align-items:center;gap:10px;max-width:280px;margin-top:4px;
                ">
                    <i class="fas ${cfg.icon}" style="color:#c5a47e;font-size:18px;"></i>
                    <span style="font-size:14px;">"${line}"</span>
                </div>
                <div style="display:flex;gap:44px;margin-top:26px;">
                    <button id="companion-incoming-reject" style="
                        display:flex;flex-direction:column;align-items:center;gap:7px;
                        background:none;border:none;cursor:pointer;color:#fff;
                    ">
                        <div style="
                            width:60px;height:60px;border-radius:50%;
                            background:linear-gradient(135deg,#ff5252,#c62828);
                            box-shadow:0 6px 20px rgba(255,82,82,.45);
                            display:flex;align-items:center;justify-content:center;
                            transition:transform 0.15s ease;font-size:22px;
                        "><i class="fas fa-xmark"></i></div>
                        <span style="font-size:12px;color:rgba(255,255,255,.48);font-weight:500;">拒绝</span>
                    </button>
                    <button id="companion-incoming-accept" style="
                        display:flex;flex-direction:column;align-items:center;gap:7px;
                        background:none;border:none;cursor:pointer;color:#fff;
                    ">
                        <div style="
                            width:60px;height:60px;border-radius:50%;
                            background:linear-gradient(135deg,#4caf50,#2e7d32);
                            box-shadow:0 6px 20px rgba(76,175,80,.45);
                            display:flex;align-items:center;justify-content:center;
                            transition:transform 0.15s ease;font-size:22px;padding:0;
                        "><i class="fas fa-heart"></i></div>
                        <span style="font-size:12px;color:rgba(255,255,255,.48);font-weight:500;">接受</span>
                    </button>
                </div>
            </div>
        `;

        injectKeyframes();
        document.documentElement.appendChild(overlay);

        // 22 秒未接听自动消失（用 isConnected 检查 overlay 是否还在 DOM）
        const autoTimer = setTimeout(() => {
            if (!overlay.isConnected) return; // 已被其他操作移除了
            overlay.remove();
            sendChatEvent('fa-heart-crack', `错过了${partnerName}的陪伴邀请`, null);
        }, 22000);

        // 拒绝
        overlay.querySelector('#companion-incoming-reject').addEventListener('click', () => {
            clearTimeout(autoTimer);
            if (overlay.isConnected) overlay.remove();
            sendChatEvent('fa-heart-crack', `拒绝了${partnerName}的陪伴邀请`, null);
        });

        // 接受 → 直接进入陪伴页（用梦角说的那个时间）
        overlay.querySelector('#companion-incoming-accept').addEventListener('click', () => {
            clearTimeout(autoTimer);
            if (overlay.isConnected) overlay.remove();
            sendChatEvent('fa-heart', `接受了${partnerName}的陪伴邀请`, null);
            enterWithInviteTime(mode, inviteTime);
        });
    }

    // ─── 随机定时邀请（梦角主动） ────────────────────────────────────────

    let _randomInviteTimer = null;

    function scheduleRandomInvite() {
        clearTimeout(_randomInviteTimer);
        // 15~60 分钟随机
        const ms = (15 + Math.random() * 45) * 60 * 1000;
        _randomInviteTimer = setTimeout(() => {
            // 25% 概率真正发起
            if (Math.random() < 0.25) {
                showIncomingCompanion();
            }
            scheduleRandomInvite(); // 递归继续下一轮
        }, ms);
        console.log(`[companion] 下次邀请检查在 ${Math.round(ms/60000)} 分钟后`);
    }

    function stopRandomInvite() {
        clearTimeout(_randomInviteTimer);
        _randomInviteTimer = null;
    }

    // ─── 梦角提前离开 ────────────────────────────────────────────────────
    // 在陪伴中每 5 分钟检查一次，5% 概率梦角提前离开（睡觉场景排除）

    const FAREWELL_LINES = [
        '有事，先走了',
        '我得忙一下，你自己加油',
        '突然有点事，下次再陪你',
        '先走一步，记得照顾自己',
        '我先离开了，你继续',
        '不好意思，得走了',
    ];

    let _earlyLeaveTimer = null;
    // 强制结果（用于测试）：null=正常随机，true=强制下次检查时离开
    let _forceEarlyLeave = false;

    function scheduleEarlyLeaveCheck() {
        clearTimeout(_earlyLeaveTimer);
        _earlyLeaveTimer = setTimeout(() => {
            // 必须仍然在陪伴中
            if (!document.getElementById('companion-page')?.classList.contains('active')) {
                return;
            }
            // 睡觉场景不会提前离开
            if (currentMode === 'sleep') {
                scheduleEarlyLeaveCheck();
                return;
            }
            // 5% 概率（或者测试模式强制触发）
            if (_forceEarlyLeave || Math.random() < 0.05) {
                _forceEarlyLeave = false;
                triggerEarlyLeave();
            } else {
                scheduleEarlyLeaveCheck();
            }
        }, 5 * 60 * 1000); // 5 分钟
    }

    function stopEarlyLeaveCheck() {
        clearTimeout(_earlyLeaveTimer);
        _earlyLeaveTimer = null;
    }

    function triggerEarlyLeave() {
        const partnerName = getPartnerName();
        const line = pickRandom(FAREWELL_LINES);
        const avSrc = getPartnerAvatarSrc();

        // 弹出告别提示（等待用户点"知道了"按钮才关闭）
        const overlay = document.createElement('div');
        overlay.id = 'companion-farewell-overlay';
        overlay.setAttribute('style', [
            'position:fixed', 'inset:0', 'z-index:99999',
            'background:rgba(15,15,20,0.92)',
            'display:flex', 'align-items:center', 'justify-content:center',
            'animation:companionFadeIn 0.9s ease',
        ].join(';'));

        const avatarHtml = avSrc
            ? `<img src="${avSrc}" style="width:100%;height:100%;object-fit:cover;">`
            : `<i class="fas fa-user" style="font-size:30px;color:rgba(255,255,255,.85);"></i>`;

        overlay.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;gap:20px;color:#fff;max-width:300px;padding:0 20px;animation:companionPopIn 1s ease;">
                <div style="
                    width:80px;height:80px;border-radius:50%;overflow:hidden;
                    background:rgba(255,255,255,0.1);
                    display:flex;align-items:center;justify-content:center;
                    border:2px solid rgba(255,255,255,0.15);
                ">${avatarHtml}</div>
                <div style="font-size:18px;font-weight:600;letter-spacing:1px;">${partnerName}</div>
                <div style="
                    background:rgba(255,255,255,0.08);border-radius:14px;padding:14px 22px;
                    display:flex;align-items:center;gap:10px;text-align:center;
                ">
                    <i class="fas fa-hand" style="color:#c5a47e;font-size:16px;"></i>
                    <span style="font-size:14px;">${line}</span>
                </div>
                <button id="companion-farewell-ack" style="
                    margin-top:14px;
                    padding:10px 32px;
                    border-radius:22px;
                    border:1px solid rgba(255,255,255,0.25);
                    background:rgba(255,255,255,0.1);
                    color:#fff;font-size:14px;letter-spacing:1.5px;
                    cursor:pointer;
                    transition:all 0.2s ease;
                ">知道了</button>
            </div>
        `;

        injectKeyframes();
        document.documentElement.appendChild(overlay);

        // 写入聊天记录
        sendChatEvent('fa-hand', `${partnerName}提前离开了陪伴`, null);

        // "知道了" 按钮点击 → 关闭告别画面 + 关闭陪伴页
        const ackBtn = overlay.querySelector('#companion-farewell-ack');
        if (ackBtn) {
            ackBtn.addEventListener('click', () => {
                if (overlay.isConnected) overlay.remove();
                closeCompanionPage();
            });
            ackBtn.addEventListener('mouseenter', () => {
                ackBtn.style.background = 'rgba(255,255,255,0.18)';
            });
            ackBtn.addEventListener('mouseleave', () => {
                ackBtn.style.background = 'rgba(255,255,255,0.1)';
            });
        }
    }

    // ─── 动画 keyframes 注入（一次性）────────────────────────────────────

    function injectKeyframes() {
        if (document.getElementById('companion-keyframes')) return;
        const style = document.createElement('style');
        style.id = 'companion-keyframes';
        style.textContent = `
            @keyframes companionFadeIn { from { opacity: 0; } to { opacity: 1; } }
            @keyframes companionPopIn { from { opacity: 0; transform: scale(0.94) translateY(10px); } to { opacity: 1; transform: scale(1) translateY(0); } }
            @keyframes companionPulseRing {
                0% { transform: scale(0.95); opacity: 0.6; }
                70% { transform: scale(1.15); opacity: 0; }
                100% { transform: scale(1.15); opacity: 0; }
            }
            @keyframes companionDot {
                0%, 60%, 100% { opacity: 0.3; transform: scale(1); }
                30% { opacity: 1; transform: scale(1.4); }
            }
        `;
        document.head.appendChild(style);
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
                <input type="file" id="setup-dyn-voice-input" accept="*/*" multiple style="display:none">
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
            let addedCount = 0;
            let skippedCount = 0;
            for (const file of files) {
                // 兼容 iOS：用 type 或文件后缀判断
                const isAudio = file.type.startsWith('audio/') ||
                    /\.(mp3|m4a|aac|wav|ogg|flac|amr|opus)$/i.test(file.name);
                if (!isAudio) {
                    skippedCount++;
                    continue;
                }
                try {
                    const base64 = await readFileAsBase64(file);
                    window._setupPendingVoices.push({
                        id: generateId(), data: base64,
                        name: file.name.replace(/\.[^/.]+$/, ''),
                        addedAt: Date.now()
                    });
                    addedCount++;
                } catch (err) {
                    console.error('[companion] 语音读取失败', err);
                    skippedCount++;
                }
            }
            renderSetupVoiceListDyn(modal);
            if (skippedCount > 0 && addedCount === 0) {
                notify('请选择音频文件（mp3/m4a/wav 等），不能上传图片或视频', 'warning');
            } else if (skippedCount > 0) {
                notify(`已添加 ${addedCount} 段，${skippedCount} 个非音频文件已跳过`, 'info');
            }
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
                if (!companionData.voices[currentMode]) companionData.voices[currentMode] = [];
                companionData.voices[currentMode].push(...window._setupPendingVoices);
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

    function openTimeModal(mode, onSelected) {
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
            <p style="font-size:13px;color:#888;text-align:center;margin:6px 0 16px;">这次陪你多久？</p>
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
                // 如果调用方提供了回调，走回调；否则按老逻辑直接进陪伴页
                if (typeof onSelected === 'function') {
                    onSelected(t);
                } else {
                    openCompanionPage();
                }
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

        // 设置玻璃球计时器副标题（场景名英文缩写）
        const timerLabel = $('companion-timer-label');
        if (timerLabel) {
            const labels = { study: 'STUDY', work: 'WORK', exercise: 'EXERCISE', sleep: 'SLEEP' };
            timerLabel.textContent = labels[currentMode] || '';
        }

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
        const page = $('companion-page');
        if (!container) return;
        container.innerHTML = '';

        if (!bg) {
            // 默认背景：米黄色系柔和渐变
            const fallback = document.createElement('div');
            fallback.style.cssText = `
                position:absolute;inset:0;
                background:
                    radial-gradient(ellipse at 30% 20%, rgba(255,228,180,0.55) 0%, transparent 60%),
                    radial-gradient(ellipse at 75% 75%, rgba(255,220,200,0.45) 0%, transparent 60%),
                    linear-gradient(135deg, #FFF2E2 0%, #FCE8D0 50%, #FFF2E2 100%);
            `;
            container.appendChild(fallback);
            // 标记当前是浅色背景，让文字切换为深色
            if (page) page.classList.add('companion-light-bg');
            return;
        }

        // 有用户背景，移除浅色标记
        if (page) page.classList.remove('companion-light-bg');

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
        stopEarlyLeaveCheck();
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
        // 同时启动梦角提前离开的检查
        scheduleEarlyLeaveCheck();
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
    }

    function onTimerEnd() {
        // 时间已到，停止"梦角提前离开"检查（不然会在用户看结束页时还可能触发）
        stopEarlyLeaveCheck();

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
        // 按当前场景取语音
        const voices = (companionData.voices && companionData.voices[currentMode]) || [];
        if (!voices.length) return;
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
        // 排除按钮、计时器区域、退出确认弹窗的点击
        if (e.target.closest('button, input, #companion-timer-area, #companion-exit-confirm')) return;
        const voices = (companionData.voices && companionData.voices[currentMode]) || [];
        if (!voices.length) {
            notify('没有什么想说的', 'info');
            return;
        }
        playRandomVoice();
    }

    // ─── 设置面板（右侧滑出）────────────────────────────────────────────────

    // 旧"陪伴页右上角设置面板"已移除，这里保留空函数防御性兜底
    function openSettingsPanel() {
        // 设置面板已迁移到外观设置 → 背景&字体
    }
    function closeSettingsPanel() { /* no-op */ }
    function renderSettingsPanel() { /* no-op */ }

    function renderVoiceManagerInPanel() {
        // ⚠️ 此函数对应的"陪伴页内右上角设置面板"将在后续移除，
        // 这里只做最低限度的兼容，避免数据结构变化引起报错
        const list = $('panel-voice-list');
        if (!list) return;
        list.innerHTML = '<p class="companion-empty-hint">请到外观设置 → 背景&字体 里管理语音</p>';
    }

    // 兼容旧调用（不再使用，仅防报错）
    window._updateVoiceName = async () => {};
    window._playVoiceById   = () => {};
    window._deleteVoice     = async () => {};

    // 面板内上传新语音
    async function handlePanelVoiceUpload(e) {
        const files = Array.from(e.target.files);
        let addedCount = 0;
        let skippedCount = 0;
        for (const file of files) {
            // 兼容 iOS：用 type 或文件后缀判断
            const isAudio = file.type.startsWith('audio/') ||
                /\.(mp3|m4a|aac|wav|ogg|flac|amr|opus)$/i.test(file.name);
            if (!isAudio) {
                skippedCount++;
                continue;
            }
            try {
                const base64 = await readFileAsBase64(file);
                // 改用当前场景的语音列表
                const targetMode = currentMode || 'study';
                if (!companionData.voices[targetMode]) companionData.voices[targetMode] = [];
                companionData.voices[targetMode].push({
                    id: generateId(),
                    data: base64,
                    name: file.name.replace(/\.[^/.]+$/, ''),
                    addedAt: Date.now()
                });
                addedCount++;
            } catch (err) {
                console.error('[companion] 语音读取失败', err);
                skippedCount++;
            }
        }
        if (addedCount > 0) {
            await saveCompanionData();
            renderVoiceManagerInPanel();
            notify(`已添加 ${addedCount} 段语音${skippedCount > 0 ? `（${skippedCount} 个非音频文件已跳过）` : ''}`, 'success');
        } else if (skippedCount > 0) {
            notify('请选择音频文件（mp3/m4a/wav 等），不能上传图片或视频', 'warning');
        }
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

    // ────────────────────────────────────────────────────────────────────
    //  外观设置里的"陪伴背景/语音"管理 UI
    // ────────────────────────────────────────────────────────────────────

    // 当前选中的 tab（背景管理 + 语音管理 各自记录）
    const _mgrState = { bg: 'study', voice: 'study' };

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    // ── 渲染：陪伴背景列表 ──
    function renderCompanionBgManager() {
        const list = document.getElementById('companion-bg-list');
        if (!list) return;
        const mode = _mgrState.bg;
        const items = (companionData.backgrounds[mode] || []);

        let html = '';
        if (items.length === 0) {
            html += `<div class="companion-mgr-empty">
                还没有添加${escapeHtml(MODES[mode].label.slice(2))}场景的背景<br>
                点击下方按钮上传图片或视频
            </div>`;
        } else {
            html += items.map(bg => `
                <div class="companion-bg-card" data-id="${bg.id}">
                    <div class="companion-bg-card-thumb">
                        ${bg.type === 'video'
                            ? `<video src="${bg.data}" muted></video><span class="type-badge">视频</span>`
                            : `<img src="${bg.data}" alt="">`
                        }
                    </div>
                    <div class="companion-bg-card-info">
                        <div class="companion-bg-card-name">${escapeHtml(bg.name || '未命名')}</div>
                        <div class="companion-bg-card-meta">${bg.type === 'video' ? '视频' : '图片'}</div>
                    </div>
                    <div class="companion-bg-card-actions">
                        <button class="companion-mgr-iconbtn danger" data-action="delete-bg" data-id="${bg.id}" title="删除">
                            <i class="fas fa-trash-can"></i>
                        </button>
                    </div>
                </div>
            `).join('');
        }
        html += `<button class="companion-mgr-add" id="companion-bg-add-btn">
            <i class="fas fa-plus"></i> 添加${escapeHtml(MODES[mode].label.slice(2))}背景
        </button>`;
        list.innerHTML = html;
    }

    // ── 渲染：陪伴语音列表 ──
    function renderCompanionVoiceManager() {
        const list = document.getElementById('companion-voice-list');
        if (!list) return;
        const mode = _mgrState.voice;
        const items = (companionData.voices[mode] || []);

        let html = '';
        if (items.length === 0) {
            html += `<div class="companion-mgr-empty">
                还没有添加${escapeHtml(MODES[mode].label.slice(2))}场景的语音<br>
                点击下方按钮上传音频文件
            </div>`;
        } else {
            html += items.map(v => `
                <div class="companion-voice-card" data-id="${v.id}">
                    <i class="fas fa-music"></i>
                    <input type="text" class="companion-voice-card-name"
                        value="${escapeHtml(v.name || '')}"
                        data-action="rename-voice" data-id="${v.id}"
                        placeholder="语音名称">
                    <div class="companion-voice-card-actions">
                        <button class="companion-mgr-iconbtn" data-action="play-voice" data-id="${v.id}" title="试听">
                            <i class="fas fa-play"></i>
                        </button>
                        <button class="companion-mgr-iconbtn danger" data-action="delete-voice" data-id="${v.id}" title="删除">
                            <i class="fas fa-trash-can"></i>
                        </button>
                    </div>
                </div>
            `).join('');
        }
        html += `<button class="companion-mgr-add" id="companion-voice-add-btn">
            <i class="fas fa-plus"></i> 添加${escapeHtml(MODES[mode].label.slice(2))}语音
        </button>`;
        list.innerHTML = html;
    }

    // ── 切换 tab ──
    function switchMgrTab(type, mode) {
        _mgrState[type] = mode;
        const tabsId = type === 'bg' ? 'companion-bg-tabs' : 'companion-voice-tabs';
        const tabs = document.getElementById(tabsId);
        if (tabs) {
            tabs.querySelectorAll('.companion-mgr-tab').forEach(t => {
                t.classList.toggle('active', t.dataset.mode === mode);
            });
        }
        if (type === 'bg') renderCompanionBgManager();
        else renderCompanionVoiceManager();
    }

    // ── 上传：背景 ──
    async function handleMgrBgUpload(e) {
        const file = e.target.files[0];
        if (!file) return;
        const isVideo = file.type.startsWith('video/');
        const isImage = file.type.startsWith('image/');
        if (!isVideo && !isImage) {
            notify('请选择图片或视频文件', 'error');
            return;
        }
        if (file.size > 100 * 1024 * 1024) notify('文件超过 100MB，加载可能较慢', 'warning');

        await ensureDataLoaded();
        try {
            notify('正在处理文件...', 'info');
            const base64 = await readFileAsBase64(file);
            const bg = {
                id: generateId(),
                type: isVideo ? 'video' : 'image',
                data: base64,
                name: file.name,
                addedAt: Date.now()
            };
            companionData.backgrounds[_mgrState.bg].push(bg);
            await saveCompanionData();
            renderCompanionBgManager();
            notify('背景已添加', 'success');
        } catch (err) {
            console.error('[companion] 背景上传失败', err);
            notify('文件读取失败', 'error');
        }
        e.target.value = '';
    }

    // ── 上传：语音 ──
    async function handleMgrVoiceUpload(e) {
        const files = Array.from(e.target.files);
        if (!files.length) return;
        await ensureDataLoaded();

        let addedCount = 0;
        let skippedCount = 0;
        for (const file of files) {
            const isAudio = file.type.startsWith('audio/') ||
                /\.(mp3|m4a|aac|wav|ogg|flac|amr|opus)$/i.test(file.name);
            if (!isAudio) { skippedCount++; continue; }
            try {
                const base64 = await readFileAsBase64(file);
                companionData.voices[_mgrState.voice].push({
                    id: generateId(),
                    data: base64,
                    name: file.name.replace(/\.[^/.]+$/, ''),
                    addedAt: Date.now()
                });
                addedCount++;
            } catch (err) {
                console.error('[companion] 语音读取失败', err);
                skippedCount++;
            }
        }
        if (addedCount > 0) {
            await saveCompanionData();
            renderCompanionVoiceManager();
            notify(`已添加 ${addedCount} 段语音${skippedCount ? `（${skippedCount} 个跳过）` : ''}`, 'success');
        } else if (skippedCount > 0) {
            notify('请选择音频文件（mp3/m4a/wav 等）', 'warning');
        }
        e.target.value = '';
    }

    // ── 删除/重命名/试听 ──
    function handleMgrAction(action, id) {
        const mode = action.includes('voice') ? _mgrState.voice : _mgrState.bg;

        if (action === 'delete-bg') {
            if (!confirm('确定删除这个背景吗？')) return;
            companionData.backgrounds[mode] = companionData.backgrounds[mode].filter(x => x.id !== id);
            saveCompanionData();
            renderCompanionBgManager();
            notify('已删除', 'success');
        } else if (action === 'delete-voice') {
            if (!confirm('确定删除这段语音吗？')) return;
            companionData.voices[mode] = companionData.voices[mode].filter(x => x.id !== id);
            saveCompanionData();
            renderCompanionVoiceManager();
            notify('已删除', 'success');
        } else if (action === 'play-voice') {
            const v = companionData.voices[mode].find(x => x.id === id);
            if (v) playVoice(v);
        }
    }

    function handleMgrVoiceRename(id, newName) {
        const mode = _mgrState.voice;
        const v = companionData.voices[mode].find(x => x.id === id);
        if (v) {
            v.name = newName;
            saveCompanionData();
        }
    }

    // ── 绑定外观设置面板的事件（用事件委托，因为 DOM 可能在打开外观设置时才显示）──
    function bindMgrEvents() {
        // tab 切换 + 操作按钮 + 加号按钮 —— 全用事件委托
        document.addEventListener('click', function (e) {
            // tab 切换
            const tab = e.target.closest('.companion-mgr-tab');
            if (tab) {
                const tabsEl = tab.closest('.companion-mgr-tabs');
                const type = tabsEl?.dataset.mgr;
                if (type && tab.dataset.mode) {
                    switchMgrTab(type, tab.dataset.mode);
                    return;
                }
            }

            // 删除/试听
            const actionBtn = e.target.closest('[data-action]');
            if (actionBtn) {
                const action = actionBtn.dataset.action;
                const id = actionBtn.dataset.id;
                if (action && id && action !== 'rename-voice') {
                    handleMgrAction(action, id);
                    return;
                }
            }

            // 加号按钮
            if (e.target.closest('#companion-bg-add-btn')) {
                document.getElementById('companion-bg-upload-input')?.click();
                return;
            }
            if (e.target.closest('#companion-voice-add-btn')) {
                document.getElementById('companion-voice-upload-input')?.click();
                return;
            }
        });

        // 语音重命名
        document.addEventListener('change', function (e) {
            if (e.target.matches('[data-action="rename-voice"]')) {
                handleMgrVoiceRename(e.target.dataset.id, e.target.value);
            }
        });

        // 文件 input 的 change 事件
        const bgInput = document.getElementById('companion-bg-upload-input');
        if (bgInput) bgInput.addEventListener('change', handleMgrBgUpload);
        const voiceInput = document.getElementById('companion-voice-upload-input');
        if (voiceInput) voiceInput.addEventListener('change', handleMgrVoiceUpload);

        // 触发渲染：用户切到"背景&字体"面板时
        // 策略 1：监听父弹窗的所有点击，凡是带 showAppearancePanel('font-bg') 的元素都刷一下
        document.addEventListener('click', async (e) => {
            // 点击进入"背景&字体"子面板的入口
            const card = e.target.closest('[onclick*="font-bg"], [onclick*="background"]');
            if (card) {
                setTimeout(async () => {
                    await ensureDataLoaded();
                    renderCompanionBgManager();
                    renderCompanionVoiceManager();
                }, 100);
            }
        });

        // 策略 2：直接立即渲染一次（即使容器还隐藏，innerHTML 也能设上，等显示时就有内容了）
        setTimeout(async () => {
            await ensureDataLoaded();
            renderCompanionBgManager();
            renderCompanionVoiceManager();
        }, 500);

        // 策略 3：原 MutationObserver 也保留作为兜底
        const bgPanel = document.getElementById('appearance-panel-background');
        if (bgPanel) {
            const observer = new MutationObserver(async () => {
                if (bgPanel.style.display !== 'none') {
                    await ensureDataLoaded();
                    renderCompanionBgManager();
                    renderCompanionVoiceManager();
                }
            });
            observer.observe(bgPanel, { attributes: true, attributeFilter: ['style'] });
        }
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

        const exitConfirmYes = $('exit-confirm-yes');
        if (exitConfirmYes) exitConfirmYes.addEventListener('click', closeCompanionPage);

        const exitConfirmNo = $('exit-confirm-no');
        if (exitConfirmNo) exitConfirmNo.addEventListener('click', hideExitConfirm);

        // 设置面板入口和相关元素已移除（统一去外观设置 → 背景&字体 管理）
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
        // 检查是否已经在某个陪伴流程中
        if (document.querySelector('#companion-inviting-overlay, #companion-incoming-overlay, #companion-modal-dynamic, #setup-modal-dynamic, #time-modal-dynamic')) {
            console.log('[companion] 已经在陪伴流程中，跳过');
            return;
        }
        if (document.getElementById('companion-page')?.classList.contains('active')) {
            console.log('[companion] 已经在陪伴页面，跳过');
            return;
        }
        const ok = await ensureDataLoaded();
        if (!ok) return;
        openCompanionModal();
    }

    async function init() {
        try {
            // 先绑定事件，这样按钮立刻可用
            bindEvents();
            // 绑定外观设置面板里的"陪伴背景/语音"管理 UI 的事件
            bindMgrEvents();
            console.log('[companion] 模块加载完成（数据将在首次使用时加载）');

            // 启动梦角主动邀请的随机定时器（15~60 分钟随机检查，25% 概率触发）
            scheduleRandomInvite();
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

    // ─── 测试接口（控制台用） ────────────────────────────────────────────
    // 用法：
    //   companionModule.testIncoming()           — 立即触发"梦角邀请你"
    //   companionModule.testIncoming('sleep')    — 指定场景的邀请
    //   companionModule.testReject('study')      — 强制拒绝（用户发起后梦角拒绝）
    //   companionModule.testAccept('work')       — 强制同意
    //   companionModule.stopRandomInvite()       — 停止随机邀请
    //   companionModule.scheduleRandomInvite()   — 重启随机邀请
    window.companionModule = {
        openCompanionModal,
        closeCompanionPage,

        // 测试：梦角主动邀请
        testIncoming: (mode) => showIncomingCompanion(mode),

        // 测试：强制拒绝（模拟用户走完"选场景 → 选时间 → 发起邀请"流程，梦角 100% 拒绝）
        testReject: async (mode = 'study') => {
            await ensureDataLoaded();
            _forceResult = 'reject';
            currentMode = mode;
            // 给一个默认 10 分钟，避免邀请等待画面里时间显示异常
            isCountdown = true;
            timerSeconds = 10 * 60;
            totalSeconds = 10 * 60;
            showCompanionInviting(mode);
            // 测试完后恢复随机
            setTimeout(() => { _forceResult = null; }, 15000);
        },

        // 测试：强制同意（模拟用户走完"选场景 → 选时间 → 发起邀请"流程，梦角 100% 同意）
        testAccept: async (mode = 'study') => {
            await ensureDataLoaded();
            _forceResult = 'accept';
            currentMode = mode;
            // 给一个默认 10 分钟，模拟用户选了时间
            isCountdown = true;
            timerSeconds = 10 * 60;
            totalSeconds = 10 * 60;
            showCompanionInviting(mode);
            setTimeout(() => { _forceResult = null; }, 15000);
        },

        // 测试：梦角立即提前离开（必须在陪伴中调用）
        testEarlyLeave: () => {
            if (!document.getElementById('companion-page')?.classList.contains('active')) {
                console.warn('[companion] 不在陪伴中，无法测试提前离开');
                return;
            }
            if (currentMode === 'sleep') {
                console.warn('[companion] 睡觉场景不会触发提前离开（按设计）');
                return;
            }
            triggerEarlyLeave();
        },

        // 测试：让下一次 5 分钟检查时强制离开（不用等概率）
        forceNextEarlyLeave: () => {
            _forceEarlyLeave = true;
            console.log('[companion] 下次 5 分钟检查时将强制离开');
        },

        // 控制随机邀请定时器
        stopRandomInvite,
        scheduleRandomInvite,
    };

})();
