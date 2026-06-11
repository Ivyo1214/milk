document.addEventListener('DOMContentLoaded', async () => {
    const loaderBar = document.getElementById('loader-tech-bar');
    const welcomeSubtitle = document.querySelector('.welcome-subtitle-scramble');
    const welcomeScreen = document.getElementById('welcome-animation');
    const disclaimerModal = document.getElementById('disclaimer-modal');
    const acceptDisclaimerBtn = document.getElementById('accept-disclaimer');

    const updateLoader = (text, width) => {
        if (welcomeSubtitle) welcomeSubtitle.textContent = text;
        if (loaderBar) loaderBar.style.width = width;
    };

    const hideWelcomeScreen = () => {
        if (!welcomeScreen) return;
        welcomeScreen.classList.add('hidden');
        setTimeout(() => {
            welcomeScreen.style.display = 'none';
        }, 800);
    };

    const safeAwait = async (promise, fallback = null) => {
        try {
            return await promise;
        } catch (error) {
            console.error('操作失败:', error);
            return fallback;
        }
    };

    try {
        try { setupEventListeners?.(); } catch(e) { console.error('setupEventListeners:', e); }

        if (typeof localforage === 'undefined') {
            console.warn('LocalForage 未加载，将使用 localStorage 降级方案');
        }

        try {
            const emergencyBackupRaw = localStorage.getItem('BACKUP_V1_critical');
            if (emergencyBackupRaw) {
                const emergencyBackup = JSON.parse(emergencyBackupRaw);
                if (emergencyBackup && Array.isArray(emergencyBackup.messages) && emergencyBackup.messages.length > 0) {
                    console.warn('[boot] 检测到紧急备份，可用于异常恢复');
                }
            }
        } catch (e) {
            console.warn('[boot] 紧急备份检查失败:', e);
        }

        updateLoader('正在建立安全连接...', '10%');
        await safeAwait(initializeSession());

        updateLoader('正在读取记忆存档...', '40%');
        await safeAwait(loadData());

        updateLoader('正在渲染我们的世界...', '70%');
        
        await Promise.allSettled([
            safeAwait(initializeRandomUI?.()),
            safeAwait(initMusicPlayer?.())
        ]);

        setInterval(checkStatusChange, 60000);

        if (disclaimerModal) {
            const tourSeen = await safeAwait(localforage?.getItem(APP_PREFIX + 'tour_seen'), false);
            
            if (!tourSeen) {
                showModal(disclaimerModal);
                
                if (acceptDisclaimerBtn && !acceptDisclaimerBtn._bound) {
                    acceptDisclaimerBtn._bound = true;
                    acceptDisclaimerBtn.addEventListener('click', () => {
                        hideModal(disclaimerModal);
                        localforage?.setItem(APP_PREFIX + 'tour_seen', true).catch(() => {});
                        startTour?.();
                    }, { once: true });
                }
            }
        }

        updateLoader('连接成功，欢迎回来。', '100%');
        setTimeout(hideWelcomeScreen, 3500);

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                try {
                    if (typeof saveTimeout !== 'undefined') clearTimeout(saveTimeout);
                } catch (e) {}
                try { _backupCriticalData(); } catch (e) { console.warn('[visibilitychange] 紧急备份失败:', e); }
                try {
                    const p = saveData();
                    if (p && typeof p.catch === 'function') {
                        p.catch(e => console.error('[visibilitychange] 保存失败:', e));
                    }
                } catch (e) {
                    console.error('[visibilitychange] 保存失败:', e);
                }
            } else if (document.visibilityState === 'visible') {
                try {
                    const backup = typeof _tryRecoverFromBackup === 'function' ? _tryRecoverFromBackup() : null;
                    if (backup && Array.isArray(backup.messages) && backup.messages.length > 0 && Array.isArray(messages) && backup.messages.length > messages.length) {
                        console.warn('[visibilitychange] 检测到备份消息比当前更多，自动尝试恢复');
                        try {
                            messages = backup.messages.map(m => ({
                                ...m,
                                timestamp: new Date(m.timestamp)
                            }));
                            if (backup.settings) Object.assign(settings, backup.settings);
                            if (typeof updateUI === 'function') updateUI();
                            if (typeof throttledSaveData === 'function') throttledSaveData();
                            showNotification('已自动恢复本地临时备份内容', 'warning', 3500);
                        } catch (restoreErr) {
                            console.warn('[visibilitychange] 自动恢复失败，保留当前页面内容:', restoreErr);
                        }
                    }
                } catch (e) {
                    console.warn('[visibilitychange] 恢复备份失败:', e);
                }
            }
        });

        window.addEventListener('pagehide', () => {
            try { _backupCriticalData(); } catch (e) {}
        });

        window.addEventListener('beforeunload', () => {
            try { _backupCriticalData(); } catch (e) {}
        });

        setInterval(() => {
            saveData().catch(e => console.warn('[autoBackup] 定时保存失败:', e));
        }, 3 * 60 * 1000);

        (() => {
            const REMIND_KEY = 'exportReminderLastShown';
            const last = parseInt(localStorage.getItem(REMIND_KEY) || '0', 10);
            const daysSince = (Date.now() - last) / (1000 * 60 * 60 * 24);
            if (daysSince >= 7) {
                setTimeout(() => {
                    showNotification('建议定期导出备份，防止数据意外丢失', 'info', 7000);
                    localStorage.setItem(REMIND_KEY, String(Date.now()));
                }, 8000);
            }
        })();

        setTimeout(async () => {
            if ('Notification' in window && Notification.permission === 'default') {
                try {
                    const permission = await Notification.requestPermission();
                    if (permission === 'granted') {
                        showNotification('已开启系统通知，收到消息时会提醒你', 'success', 3000);
                    }
                } catch(e) {
                    console.warn('通知权限请求失败:', e);
                }
            }
        }, 3000);

    } catch (err) {
        console.error('严重初始化错误:', err);
        try {
            const backup = typeof _tryRecoverFromBackup === 'function' ? _tryRecoverFromBackup() : null;
            if (backup && Array.isArray(backup.messages) && backup.messages.length > 0) {
                messages = backup.messages.map(m => ({
                    ...m,
                    timestamp: new Date(m.timestamp)
                }));
                if (backup.settings) Object.assign(settings, backup.settings);
                if (typeof updateUI === 'function') updateUI();
                showNotification('初始化异常，已使用本地紧急备份恢复', 'warning', 5000);
            }
        } catch (recoverErr) {
            console.warn('[boot] 初始化失败后的恢复也失败:', recoverErr);
        }
        updateLoader('加载遇到问题，已强制进入...', '100%');
        setTimeout(hideWelcomeScreen, 3500);
    }
});
const stickerInput = document.getElementById('sticker-file-input');
            if (stickerInput) {
                stickerInput.addEventListener('change', async (e) => {
                    const files = Array.from(e.target.files);
                    if (!files.length) return;

                    const oversized = files.filter(f => f.size > 2 * 1024 * 1024);
                    if (oversized.length > 0) {
                        showNotification(oversized.length + ' 张图片超过 2MB 限制，已跳过', 'warning');
                    }

                    const validFiles = files.filter(f => f.size <= 2 * 1024 * 1024);
                    if (!validFiles.length) return;

                    showNotification('正在批量处理 ' + validFiles.length + ' 张图片...', 'info');

                    let successCount = 0;
                    let failCount = 0;

                    for (const file of validFiles) {
                        try {
                            const base64 = await optimizeImage(file, 300, 0.8);
                            stickerLibrary.push(base64);
                            successCount++;
                        } catch (err) {
                            console.error(err);
                            failCount++;
                        }
                    }

                    throttledSaveData();
                    renderReplyLibrary();

                    if (failCount > 0) {
                        showNotification('上传完成：' + successCount + ' 张成功，' + failCount + ' 张失败', 'warning');
                    } else {
                        showNotification('上传成功，共 ' + successCount + ' 张', 'success');
                    }

                    e.target.value = '';
                });
            }
const myStickerQuickUpload = document.getElementById('my-sticker-quick-upload');
if (myStickerQuickUpload) {
    myStickerQuickUpload.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        if (!files.length) return;
        const oversized = files.filter(f => f.size > 2 * 1024 * 1024);
        if (oversized.length > 0) showNotification(oversized.length + ' 张图片超过 2MB，已跳过', 'warning');
        const validFiles = files.filter(f => f.size <= 2 * 1024 * 1024);
        if (!validFiles.length) return;
        showNotification('正在处理 ' + validFiles.length + ' 张...', 'info');
        let ok = 0, fail = 0;
        const newStickers = [];
        for (const file of validFiles) {
            try {
                const base64 = await optimizeImage(file, 300, 0.8);
                newStickers.push(base64);
                ok++;
            } catch(err) { fail++; }
        }
        // 新表情插到最前面，批量上传时保持原顺序
        myStickerLibrary.unshift(...newStickers);
        throttledSaveData();
        if (typeof renderComboContent === 'function') renderComboContent('my-sticker');
        showNotification(fail > 0 ? `上传完成：${ok} 成功 ${fail} 失败` : `✓ 已添加 ${ok} 张到我的表情库`, fail > 0 ? 'warning' : 'success');
        e.target.value = '';
    });
}

// 启动时检查闪退未结束的陪伴会话（独立于 load 事件，确保一定执行）
(function() {
    function _cdRecLog(msg, data) {
        try {
            const logs = JSON.parse(localStorage.getItem('_cdRecLogs') || '[]');
            logs.push({ t: new Date().toLocaleTimeString(), msg: msg, data: data === undefined ? '' : JSON.stringify(data) });
            if (logs.length > 50) logs.splice(0, logs.length - 50);
            localStorage.setItem('_cdRecLogs', JSON.stringify(logs));
        } catch (e) {}
        try { console.log('[cdRec]', msg, data !== undefined ? data : ''); } catch (e) {}
    }

    _cdRecLog('script 已加载，准备启动检查');

    async function doRecoverCheck(attempt) {
        attempt = attempt || 1;
        _cdRecLog('开始恢复检查，第 ' + attempt + ' 次');
        try {
            if (!window.localforage) {
                _cdRecLog('❌ localforage 未加载');
                if (attempt < 5) setTimeout(() => doRecoverCheck(attempt + 1), 2000);
                return;
            }

            // 直接扫描所有 key，找含 companionLiveSession 的那个
            // 这样不依赖 SESSION_ID 是否初始化
            const allKeys = await localforage.keys();
            _cdRecLog('localforage key 总数', allKeys.length);

            const sessionKeys = allKeys.filter(k => k.indexOf('companionLiveSession') !== -1);
            _cdRecLog('匹配的 session key', sessionKeys);

            if (sessionKeys.length === 0) {
                _cdRecLog('无未结束的会话');
                return;
            }

            // 取最近一条（按心跳时间排序，最新的优先）
            let bestSession = null;
            let bestKey = null;
            for (const k of sessionKeys) {
                const s = await localforage.getItem(k);
                if (s && s.mode && s.heartbeatTs) {
                    if (!bestSession || s.heartbeatTs > bestSession.heartbeatTs) {
                        bestSession = s;
                        bestKey = k;
                    }
                }
            }

            _cdRecLog('最近的会话 key', bestKey);
            _cdRecLog('会话数据', bestSession);

            if (!bestSession) {
                _cdRecLog('所有 key 都是空数据，清理');
                for (const k of sessionKeys) {
                    await localforage.removeItem(k).catch(() => {});
                }
                return;
            }

            const elapsedSinceHeartbeat = Date.now() - bestSession.heartbeatTs;
            _cdRecLog('心跳距今秒数', Math.floor(elapsedSinceHeartbeat / 1000));

            if (elapsedSinceHeartbeat > 24 * 60 * 60 * 1000) {
                _cdRecLog('超过 24 小时，丢弃');
                await localforage.removeItem(bestKey).catch(() => {});
                return;
            }

            // 把找到的真实 key 存起来，方便弹窗按钮使用
            window.__cdRecoverFoundKey = bestKey;
            window.__cdRecoverFoundSession = bestSession;

            _cdRecLog('✓ 准备显示恢复弹窗');
            if (typeof showCompanionRecoverDialog === 'function') {
                showCompanionRecoverDialog(bestSession);
                _cdRecLog('✓ 弹窗函数已调用');
            } else {
                _cdRecLog('❌ showCompanionRecoverDialog 函数不存在，等待 2 秒后重试');
                setTimeout(() => {
                    if (typeof showCompanionRecoverDialog === 'function') {
                        showCompanionRecoverDialog(bestSession);
                        _cdRecLog('✓ 重试成功，弹窗函数已调用');
                    } else {
                        _cdRecLog('❌ 重试后仍无 showCompanionRecoverDialog');
                    }
                }, 2000);
            }
        } catch(e) {
            _cdRecLog('❌ 异常', String(e && e.message || e));
        }
    }

    // 8 秒后启动（给 localforage、SESSION_ID 充足初始化时间）
    setTimeout(() => doRecoverCheck(1), 8000);
})();

window.addEventListener('load', function() {
    setTimeout(function() {
        try {
            if (localStorage.getItem('dailyGreetingShown') === new Date().toDateString()) return;
            try { if (typeof checkPartnerDailyMood === 'function') checkPartnerDailyMood(); } catch(e2) { console.warn('checkPartnerDailyMood error:', e2); }
            if (typeof _buildDailyGreeting === 'function') _buildDailyGreeting();
            if (window.localforage && window.APP_PREFIX) {
                localforage.getItem(window.APP_PREFIX + 'tour_seen').then(function(seen) {
                    if (seen) {
                        var modal = document.getElementById('daily-greeting-modal');
                        if (modal) modal.classList.remove('hidden');
                        localStorage.setItem('dailyGreetingShown', new Date().toDateString());
                    }
                }).catch(function() {
                    var modal = document.getElementById('daily-greeting-modal');
                    if (modal) modal.classList.remove('hidden');
                    localStorage.setItem('dailyGreetingShown', new Date().toDateString());
                });
            } else {
                var modal = document.getElementById('daily-greeting-modal');
                if (modal) modal.classList.remove('hidden');
                localStorage.setItem('dailyGreetingShown', new Date().toDateString());
            }
        } catch(e) { console.warn('Daily greeting timing error:', e); }

        // 启动时检查梦角是否主动来信
        try {
            if (typeof checkEnvelopeStatus === 'function') {
                checkEnvelopeStatus().catch(function(e) { console.warn('envelope launch check error:', e); });
            }
        } catch(e) { console.warn('envelope launch check error:', e); }
    }, 4500);
}, { once: true });

// 陪伴闪退恢复弹窗
function showCompanionRecoverDialog(session) {
    const modeNames = { study: '学习', work: '工作', exercise: '运动', sleep: '睡觉' };
    const modeName = modeNames[session.mode] || '陪伴';
    const startTime = new Date(session.startTs);
    const startTimeStr = ('0' + startTime.getHours()).slice(-2) + ':' + ('0' + startTime.getMinutes()).slice(-2);

    // 估算已用时间
    const elapsedSec = Math.max(0, Math.floor((session.heartbeatTs - session.startTs) / 1000) + (session.accumulatedExtendTime || 0));
    const elapsedMin = Math.floor(elapsedSec / 60);
    const elapsedStr = elapsedMin >= 60
        ? Math.floor(elapsedMin / 60) + 'h ' + (elapsedMin % 60) + 'min'
        : elapsedMin + 'min';

    // 倒计时模式下计算剩余时间
    let remainingStr = '';
    let canContinue = true;
    if (session.isCountdown) {
        const remainingSec = session.totalSeconds - elapsedSec;
        if (remainingSec <= 0) {
            canContinue = false;
        } else {
            const remainingMin = Math.floor(remainingSec / 60);
            remainingStr = remainingMin >= 60
                ? Math.floor(remainingMin / 60) + 'h ' + (remainingMin % 60) + 'min'
                : remainingMin + 'min';
        }
    }

    const overlay = document.createElement('div');
    overlay.id = 'companion-recover-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.55);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;animation:fadeIn 0.25s ease;padding:20px;';

    overlay.innerHTML = `
        <div style="background:var(--secondary-bg);border-radius:20px;padding:24px 22px 20px;width:100%;max-width:340px;box-shadow:0 20px 60px rgba(0,0,0,0.4);font-family:var(--font-family);">
            <div style="font-size:15px;font-weight:600;color:var(--text-primary);margin-bottom:6px;display:flex;align-items:center;gap:8px;">
                <i class="fas fa-hourglass-half" style="color:var(--accent-color);"></i>
                上次陪伴还没结束
            </div>
            <div style="font-size:12px;color:var(--text-secondary);line-height:1.7;margin-bottom:16px;">
                检测到一次未结束的「${modeName}」陪伴<br>
                · 开始时间：${startTimeStr}<br>
                · 已陪伴：${elapsedStr}
                ${session.isCountdown && canContinue ? '<br>· 剩余时间：约 ' + remainingStr : ''}
            </div>
            <div style="display:flex;flex-direction:column;gap:8px;">
                ${canContinue ? `
                <button id="_cmp_rec_continue" style="padding:11px;border:none;border-radius:12px;background:var(--accent-color);color:#fff;font-size:13px;font-weight:600;cursor:pointer;font-family:var(--font-family);">
                    <i class="fas fa-play" style="margin-right:6px;"></i>继续陪伴
                </button>` : ''}
                <button id="_cmp_rec_save" style="padding:11px;border:1px solid var(--border-color);border-radius:12px;background:var(--primary-bg);color:var(--text-primary);font-size:13px;cursor:pointer;font-family:var(--font-family);">
                    <i class="fas fa-save" style="margin-right:6px;color:var(--accent-color);"></i>结束并保存到日记
                </button>
                <button id="_cmp_rec_discard" style="padding:11px;border:1px solid var(--border-color);border-radius:12px;background:none;color:var(--text-secondary);font-size:12px;cursor:pointer;font-family:var(--font-family);">
                    丢弃这次陪伴
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    function closeDialog() { overlay.remove(); }

    const continueBtn = document.getElementById('_cmp_rec_continue');
    if (continueBtn) {
        continueBtn.onclick = function() {
            const ok = window._companionRecoverModule.resumeFromSession(session);
            if (!ok) {
                // 恢复失败 → 写日记
                window._companionRecoverModule.saveSessionAsDiary(session);
                window._companionRecoverModule.clearLiveSession();
            }
            closeDialog();
        };
    }
    document.getElementById('_cmp_rec_save').onclick = async function() {
        await window._companionRecoverModule.saveSessionAsDiary(session);
        window._companionRecoverModule.clearLiveSession();
        if (typeof showNotification === 'function') showNotification('已保存到陪伴日记', 'success');
        closeDialog();
    };
    document.getElementById('_cmp_rec_discard').onclick = function() {
        if (!confirm('确定丢弃这次陪伴记录吗？')) return;
        window._companionRecoverModule.clearLiveSession();
        closeDialog();
    };
}

// ============================================
// 陪伴模式 (Companion Mode) - 新增功能
// ============================================
function selectCompanionMode(mode) {
    // mode 可以是: 'study' | 'work' | 'exercise' | 'sleep'
    const modeNames = {
        study: '陪我学习',
        work: '陪我工作',
        exercise: '陪我运动',
        sleep: '陪我睡觉'
    };

    const modeName = modeNames[mode] || '陪伴';

    // 关闭陪伴主弹窗
    const modal = document.getElementById('companion-modal');
    if (modal && typeof hideModal === 'function') {
        hideModal(modal);
    }

    // 子页面占位 —— 后续可在此处接入对应子功能
    // TODO: 后续接入 study / work / exercise / sleep 各自的子页面
    setTimeout(() => {
        if (typeof window.showToast === 'function') {
            window.showToast(`已选择「${modeName}」，子页面开发中...`);
        } else {
            alert(`已选择「${modeName}」，子页面开发中...`);
        }
    }, 300);
}
