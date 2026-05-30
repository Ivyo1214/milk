/* ────────────────────────────────────────────────────────────────
 * 首页改造 · 第四步（批次1）：语音录音、发送、播放
 * 独立文件，不影响其他逻辑。
 * 依赖：MediaRecorder API、Web Audio API、项目原 addMessage
 * ──────────────────────────────────────────────────────────────── */
(function () {
    'use strict';

    const MAX_DURATION_MS = 60 * 1000;  // 单条语音最长 60 秒

    function ready(fn) {
        if (document.readyState !== 'loading') {
            setTimeout(fn, 80);
        } else {
            document.addEventListener('DOMContentLoaded', () => setTimeout(fn, 80));
        }
    }

    ready(function init() {
        const voiceBtn      = document.getElementById('voice-btn');
        const recorder      = document.getElementById('voice-recorder');
        const cancelBtn     = document.getElementById('voice-recorder-cancel');
        const sendBtn       = document.getElementById('voice-recorder-send');
        const waveCanvas    = document.getElementById('voice-recorder-wave');
        const timeLabel     = document.getElementById('voice-recorder-time');
        const inputArea     = document.querySelector('.input-area');

        if (!voiceBtn || !recorder) {
            console.warn('[voice] 语音元素未找到');
            return;
        }

        // ─────────── 录音状态 ───────────
        let mediaRecorder    = null;
        let audioChunks      = [];
        let audioStream      = null;
        let audioContext     = null;
        let analyser         = null;
        let waveRafId        = null;
        let startTime        = 0;
        let timerInterval    = null;
        let stopReason       = '';   // 'send' / 'cancel' / 'maxtime'
        // SpeechRecognition 相关
        let recognition      = null;
        let transcriptText   = '';

        // ─────────── 点击麦克风 → 开始录音 ───────────
        voiceBtn.addEventListener('click', async () => {
            if (mediaRecorder && mediaRecorder.state === 'recording') return;

            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                notify('当前浏览器不支持录音', 'error');
                return;
            }
            if (typeof MediaRecorder === 'undefined') {
                notify('当前浏览器不支持 MediaRecorder', 'error');
                return;
            }

            try {
                audioStream = await navigator.mediaDevices.getUserMedia({
                    audio: true,
                    video: false
                });
            } catch (err) {
                console.error('[voice] getUserMedia failed:', err);
                let msg = '无法访问麦克风';
                if (err && err.name === 'NotAllowedError')  msg = '请允许麦克风权限';
                if (err && err.name === 'NotFoundError')    msg = '没有找到麦克风';
                notify(msg, 'error');
                return;
            }

            // 选择 mimeType（iOS Safari 只支持 mp4，其他主流支持 webm）
            const mime = pickMimeType();
            try {
                mediaRecorder = mime ? new MediaRecorder(audioStream, { mimeType: mime })
                                     : new MediaRecorder(audioStream);
            } catch (e) {
                mediaRecorder = new MediaRecorder(audioStream);
            }

            audioChunks = [];
            mediaRecorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) audioChunks.push(e.data);
            };
            mediaRecorder.onstop = handleRecordingStop;

            mediaRecorder.start();
            startTime = Date.now();
            transcriptText = '';
            showRecorder();
            startTimer();
            startWaveAnimation();
            startSpeechRecognition();
        });

        // ─────────── 取消按钮 ───────────
        cancelBtn.addEventListener('click', () => {
            stopReason = 'cancel';
            if (mediaRecorder && mediaRecorder.state === 'recording') {
                mediaRecorder.stop();
            } else {
                cleanup();
            }
        });

        // ─────────── 发送按钮 ───────────
        sendBtn.addEventListener('click', () => {
            stopReason = 'send';
            if (mediaRecorder && mediaRecorder.state === 'recording') {
                mediaRecorder.stop();
            }
        });

        // ─────────── 60s 超时自动停止并发送 ───────────
        function startTimer() {
            timerInterval = setInterval(() => {
                const elapsed = Date.now() - startTime;
                timeLabel.textContent = formatTime(elapsed);
                if (elapsed >= MAX_DURATION_MS) {
                    stopReason = 'maxtime';
                    if (mediaRecorder && mediaRecorder.state === 'recording') {
                        mediaRecorder.stop();
                    }
                }
            }, 100);
        }

        // ─────────── 录音停止后的总处理 ───────────
        async function handleRecordingStop() {
            const duration = Math.round((Date.now() - startTime) / 1000);
            stopSpeechRecognition();
            // 保留识别文本到本地变量，因为 cleanup 后会被清掉
            const savedTranscript = (transcriptText || '').trim();

            if (stopReason === 'send' || stopReason === 'maxtime') {
                // 太短（小于 1 秒）当成不发送
                if (duration < 1) {
                    notify('录音时间太短', 'warning');
                    cleanup();
                    return;
                }
                const blob = new Blob(audioChunks, {
                    type: (mediaRecorder && mediaRecorder.mimeType) || 'audio/webm'
                });
                try {
                    const dataUrl = await blobToDataURL(blob);
                    sendVoiceMessage(dataUrl, duration, savedTranscript);
                } catch (e) {
                    console.error('[voice] base64 转换失败', e);
                    notify('发送失败', 'error');
                }
            }
            // cancel 不做任何发送
            cleanup();
        }

        // ─────────── 发送语音消息（沿用 addMessage 流程）───────────
        function sendVoiceMessage(dataUrl, duration, transcript) {
            if (typeof addMessage !== 'function') {
                notify('发送函数未就绪', 'error');
                return;
            }
            addMessage({
                id: Date.now(),
                sender: 'user',
                text: '',
                timestamp: new Date(),
                voice: { url: dataUrl, duration: duration, transcript: transcript || '' },
                status: 'sent',
                favorited: false,
                note: null,
                replyTo: (typeof currentReplyTo !== 'undefined') ? currentReplyTo : null,
                type: 'normal'
            });
            if (typeof playSound === 'function') playSound('send');
            if (typeof currentReplyTo !== 'undefined') window.currentReplyTo = null;
            if (typeof updateReplyPreview === 'function') updateReplyPreview();
            // 触发对方回复
            if (typeof simulateReply === 'function' && typeof settings !== 'undefined') {
                const range = (settings.replyDelayMax || 3000) - (settings.replyDelayMin || 1000);
                const delay = (settings.replyDelayMin || 1000) + Math.random() * range;
                setTimeout(simulateReply, delay);
            }
        }

        // ─────────── 清理录音资源 ───────────
        function cleanup() {
            if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
            if (waveRafId)     { cancelAnimationFrame(waveRafId); waveRafId = null; }
            if (audioStream) {
                audioStream.getTracks().forEach(t => t.stop());
                audioStream = null;
            }
            if (audioContext && audioContext.state !== 'closed') {
                try { audioContext.close(); } catch (e) {}
                audioContext = null;
            }
            analyser = null;
            mediaRecorder = null;
            audioChunks = [];
            stopReason = '';
            transcriptText = '';
            timeLabel.textContent = '0:00';
            hideRecorder();
        }

        // ─────────── 切换录音条 / 输入区显示 ───────────
        function showRecorder() {
            inputArea.classList.add('recording');
            recorder.style.display = 'flex';
        }
        function hideRecorder() {
            inputArea.classList.remove('recording');
            recorder.style.display = 'none';
        }

        // ─────────── 波形动画（实时） ───────────
        function startWaveAnimation() {
            try {
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
                const source = audioContext.createMediaStreamSource(audioStream);
                analyser = audioContext.createAnalyser();
                analyser.fftSize = 256;
                source.connect(analyser);
            } catch (e) {
                console.warn('[voice] 波形分析器初始化失败', e);
                return;
            }

            const ctx = waveCanvas.getContext('2d');
            const bufferLen = analyser.frequencyBinCount;
            const data = new Uint8Array(bufferLen);

            function draw() {
                if (!analyser) return;
                waveRafId = requestAnimationFrame(draw);
                analyser.getByteFrequencyData(data);

                // 取 CSS color: 使用 accent-color
                const cssColor = getComputedStyle(document.documentElement)
                    .getPropertyValue('--accent-color').trim() || '#888';

                // resize canvas to its CSS size for crisp render
                const w = waveCanvas.clientWidth;
                const h = waveCanvas.clientHeight;
                if (waveCanvas.width !== w || waveCanvas.height !== h) {
                    waveCanvas.width = w;
                    waveCanvas.height = h;
                }
                ctx.clearRect(0, 0, w, h);

                const barCount = 28;
                const barGap = 3;
                const barW = (w - barGap * (barCount - 1)) / barCount;
                ctx.fillStyle = cssColor;

                for (let i = 0; i < barCount; i++) {
                    const idx = Math.floor(i * bufferLen / barCount);
                    const v = data[idx] / 255;            // 0..1
                    const barH = Math.max(2, v * h * 0.9);
                    const x = i * (barW + barGap);
                    const y = (h - barH) / 2;
                    ctx.fillRect(x, y, barW, barH);
                }
            }
            draw();
        }

        // ─────────── SpeechRecognition（录音同步转文字）───────────
        function startSpeechRecognition() {
            const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!SR) {
                console.log('[voice] SpeechRecognition 不可用（浏览器不支持）');
                return;   // 不支持就跳过，录音照常进行
            }
            try {
                recognition = new SR();
                recognition.continuous = true;        // 持续识别
                recognition.interimResults = false;   // 只要最终结果
                recognition.lang = 'zh-CN';           // 中文识别（如果用户说英文，浏览器会兜底）
                recognition.onresult = (e) => {
                    for (let i = e.resultIndex; i < e.results.length; i++) {
                        const r = e.results[i];
                        if (r.isFinal) {
                            transcriptText += r[0].transcript;
                        }
                    }
                };
                recognition.onerror = (e) => {
                    console.log('[voice] SpeechRecognition error:', e.error);
                };
                recognition.onend = () => {
                    // 如果还在录音但识别结束了，自动重启（Chrome 会自动断）
                    if (mediaRecorder && mediaRecorder.state === 'recording') {
                        try { recognition.start(); } catch (e) {}
                    }
                };
                recognition.start();
            } catch (e) {
                console.warn('[voice] SpeechRecognition 启动失败', e);
                recognition = null;
            }
        }

        function stopSpeechRecognition() {
            if (recognition) {
                try { recognition.stop(); } catch (e) {}
                recognition = null;
            }
        }

        // ─────────── helper ───────────
        function pickMimeType() {
            const candidates = [
                'audio/webm;codecs=opus',
                'audio/webm',
                'audio/mp4',
                'audio/mpeg'
            ];
            for (const c of candidates) {
                if (typeof MediaRecorder.isTypeSupported === 'function' &&
                    MediaRecorder.isTypeSupported(c)) {
                    return c;
                }
            }
            return '';
        }

        function blobToDataURL(blob) {
            return new Promise((resolve, reject) => {
                const r = new FileReader();
                r.onload  = () => resolve(r.result);
                r.onerror = () => reject(new Error('read fail'));
                r.readAsDataURL(blob);
            });
        }

        function formatTime(ms) {
            const s = Math.floor(ms / 1000);
            const mm = Math.floor(s / 60);
            const ss = s % 60;
            return mm + ':' + String(ss).padStart(2, '0');
        }

        function notify(text, type, duration) {
            if (typeof showNotification === 'function') {
                showNotification(text, type || 'info', duration || 2000);
            } else {
                console.log('[notify]', text);
            }
        }

        // ─────────── 让聊天里的语音气泡能播放 ───────────
        // 项目里 addMessage 渲染消息时如果有 `voice` 字段，会被原有渲染逻辑识别吗？
        // 答案：不会。所以我们要做"补丁"渲染——监听消息容器，把有 voice 字段的
        //       消息的气泡内容换成 voice-bubble。
        // 实现：在 addMessage 之后用 MutationObserver 监听新增的 wrapper，
        //       从 dataset 里找消息 id，找到对应消息数据，渲染语音气泡。
        // 对方伪语音概率（20%）
        const FAKE_VOICE_PROBABILITY = 0.20;

        function maybeFakeVoiceForPartner(wrapper) {
            // 只对"对方"的"文本"消息生效
            if (!wrapper.classList.contains('received')) return;
            const msgId = wrapper.dataset.msgId || wrapper.dataset.id;
            if (!msgId) return;
            const msg = findMessage(msgId);
            if (!msg) return;
            // 已经是语音/图片/系统消息 → 跳过
            if (msg.voice || msg.image || msg.type === 'system') return;
            if (!msg.text || !msg.text.trim()) return;
            // 标记，避免刷新页面后再次随机
            if (msg._fakeVoiceConsidered) return;
            msg._fakeVoiceConsidered = true;

            // 20% 概率
            if (Math.random() >= FAKE_VOICE_PROBABILITY) return;

            // 随机 3-60 秒时长
            const duration = 3 + Math.floor(Math.random() * 58);
            msg.voice = {
                url: '',                       // 没有真音频
                duration: duration,
                fakeText: msg.text,            // 把原文字保存为下方"贴的文字"
                transcript: ''
            };
            msg.text = '';
            // 持久化（如果项目有这个函数）
            if (typeof throttledSaveData === 'function') throttledSaveData();
        }

        const chatContainer = document.getElementById('chat-container');
        if (chatContainer) {
            const observer = new MutationObserver((mutations) => {
                mutations.forEach((m) => {
                    m.addedNodes.forEach((node) => {
                        if (!(node instanceof HTMLElement)) return;
                        if (node.classList && node.classList.contains('message-wrapper')) {
                            maybeFakeVoiceForPartner(node);
                            renderVoiceIfNeeded(node);
                        }
                    });
                });
            });
            observer.observe(chatContainer, { childList: true });

            // 启动时也扫描一遍（用于刷新页面后从数据恢复）
            chatContainer.querySelectorAll('.message-wrapper').forEach(renderVoiceIfNeeded);
        }

        function renderVoiceIfNeeded(wrapper) {
            const msgId = wrapper.dataset.msgId || wrapper.dataset.id;
            if (!msgId) return;
            const msg = findMessage(msgId);
            if (!msg || !msg.voice) return;
            if (wrapper.dataset.voiceRendered === '1') return;
            wrapper.dataset.voiceRendered = '1';

            const bubble = wrapper.querySelector('.message');
            if (!bubble) return;

            const isFake = !msg.voice.url;   // 对方伪语音：没有 url
            const duration = msg.voice.duration || 0;
            const transcript = msg.voice.transcript || '';
            const fakeText = msg.voice.fakeText || '';

            const bars = Array.from({ length: 8 }, () =>
                `<span style="width:2px;height:${30 + Math.random() * 50}%;"></span>`
            ).join('');

            // 气泡内部：语音条
            const bubbleHtml = `
                <div class="voice-bubble" ${isFake ? 'data-fake="1"' : `data-voice-url="${escapeAttr(msg.voice.url)}"`} data-duration="${duration}">
                    <span class="voice-bubble-icon"><i class="fas fa-volume-up"></i></span>
                    <span class="voice-bubble-bars">${bars}</span>
                    <span class="voice-bubble-duration">${duration}"</span>
                </div>
                ${isFake && fakeText ? `<div class="voice-fake-text">${escapeHtml(fakeText)}</div>` : ''}
                ${transcript && !isFake ? `<div class="voice-transcript" data-role="transcript" style="display:none;">${escapeHtml(transcript)}</div>` : ''}
            `;
            bubble.innerHTML = bubbleHtml;

            // 给真实语音的 meta-actions 追加"转文字"按钮
            if (!isFake) {
                const actions = wrapper.querySelector('.message-meta-actions');
                if (actions && !actions.querySelector('.transcript-btn')) {
                    const btn = document.createElement('button');
                    btn.className = 'meta-action-btn transcript-btn';
                    btn.title = '转文字';
                    btn.innerHTML = '<i class="fas fa-font"></i>';
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        toggleTranscript(wrapper, msg);
                    });
                    actions.appendChild(btn);
                }
            }
        }

        function toggleTranscript(wrapper, msg) {
            // 关闭长按菜单
            wrapper.classList.remove('menu-visible');

            const bubble = wrapper.querySelector('.message');
            if (!bubble) return;
            let box = bubble.querySelector('[data-role="transcript"]');
            const transcript = (msg.voice && msg.voice.transcript) || '';

            if (!box) {
                // 第一次显示（之前没识别结果就没渲染那个 div）
                box = document.createElement('div');
                box.className = 'voice-transcript';
                box.dataset.role = 'transcript';
                if (transcript) {
                    box.textContent = transcript;
                } else {
                    box.classList.add('voice-transcript-empty');
                    box.textContent = '识别失败或无内容';
                }
                bubble.appendChild(box);
            } else {
                // 已有 → 切换显示/隐藏
                box.style.display = (box.style.display === 'none') ? '' : 'none';
            }
        }

        function escapeHtml(s) {
            return String(s)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
        }

        function findMessage(id) {
            if (typeof messages === 'undefined' || !Array.isArray(messages)) return null;
            return messages.find(m => String(m.id) === String(id));
        }

        function escapeAttr(s) {
            return String(s).replace(/"/g, '&quot;');
        }

        // 点击语音气泡播放，长按弹菜单
        let currentAudio = null;
        let currentBubble = null;
        let pressTimer = null;
        let pressMoved = false;
        let isLongPress = false;
        const LONG_PRESS_MS = 500;

        function findVoiceBubbleFromTarget(target) {
            return target.closest('.voice-bubble');
        }
        function findWrapperFromTarget(target) {
            return target.closest('.message-wrapper');
        }

        // 给 wrapper 加 .menu-visible，固定显示 hover 按钮
        function showMessageMenu(wrapper) {
            // 移除其他已显示的菜单
            document.querySelectorAll('.message-wrapper.menu-visible').forEach(w => {
                if (w !== wrapper) w.classList.remove('menu-visible');
            });
            wrapper.classList.add('menu-visible');
        }
        // 点击空白处关闭菜单
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.message-wrapper.menu-visible')) {
                document.querySelectorAll('.message-wrapper.menu-visible').forEach(w => {
                    w.classList.remove('menu-visible');
                });
            }
        }, true);

        // pointerdown：开始长按计时（任意消息）
        document.body.addEventListener('pointerdown', (e) => {
            const wrapper = findWrapperFromTarget(e.target);
            if (!wrapper) return;
            // 点的是 meta-action 按钮自身？放过
            if (e.target.closest('.meta-action-btn')) return;

            pressMoved = false;
            isLongPress = false;
            pressTimer = setTimeout(() => {
                isLongPress = true;
                showMessageMenu(wrapper);
                // 触觉反馈（如果支持）
                if (navigator.vibrate) navigator.vibrate(20);
            }, LONG_PRESS_MS);
        });

        document.body.addEventListener('pointermove', (e) => {
            // 移动超过几像素 → 取消长按
            if (pressTimer) {
                pressMoved = true;
                clearTimeout(pressTimer);
                pressTimer = null;
            }
        });

        document.body.addEventListener('pointerup', (e) => {
            if (pressTimer) {
                clearTimeout(pressTimer);
                pressTimer = null;
            }
            // 不是长按 → 看看是不是单击语音气泡（播放）
            if (!isLongPress && !pressMoved) {
                const bubble = findVoiceBubbleFromTarget(e.target);
                if (bubble) {
                    handleBubbleClick(bubble);
                }
            }
            isLongPress = false;
        });

        document.body.addEventListener('pointercancel', () => {
            if (pressTimer) clearTimeout(pressTimer);
            pressTimer = null;
            isLongPress = false;
        });

        function handleBubbleClick(bubble) {
            const url = bubble.dataset.voiceUrl;
            if (!url) {
                // 对方伪语音：没有真实 url，假装播放
                playFakeVoice(bubble);
                return;
            }
            // 如果当前正在播这个 → 暂停
            if (currentBubble === bubble && currentAudio && !currentAudio.paused) {
                currentAudio.pause();
                bubble.classList.remove('playing');
                return;
            }
            // 否则切换播放对象
            if (currentAudio) {
                currentAudio.pause();
                if (currentBubble) currentBubble.classList.remove('playing');
            }
            currentAudio = new Audio(url);
            currentBubble = bubble;
            bubble.classList.add('playing');
            currentAudio.play().catch(err => {
                console.error('[voice] play failed', err);
                bubble.classList.remove('playing');
            });
            currentAudio.onended = () => {
                bubble.classList.remove('playing');
                currentAudio = null;
                currentBubble = null;
            };
        }

        // 对方伪语音"假装播放"：按时长走完，没有音频
        function playFakeVoice(bubble) {
            const duration = Number(bubble.dataset.duration) || 3;
            if (currentBubble === bubble && bubble.classList.contains('playing')) {
                bubble.classList.remove('playing');
                if (bubble._fakeTimer) {
                    clearTimeout(bubble._fakeTimer);
                    bubble._fakeTimer = null;
                }
                return;
            }
            if (currentBubble) currentBubble.classList.remove('playing');
            if (currentAudio) { currentAudio.pause(); currentAudio = null; }
            currentBubble = bubble;
            bubble.classList.add('playing');
            bubble._fakeTimer = setTimeout(() => {
                bubble.classList.remove('playing');
                bubble._fakeTimer = null;
                currentBubble = null;
            }, duration * 1000);
        }

        // ─────────── 引用语音消息时，预览框显示「🔊 语音」而不是「图片」───────────
        // 思路：在 updateReplyPreview 跑之前，根据 currentReplyTo.id 找到原消息，
        //       如果是语音，就给 currentReplyTo.text 注入一个标签。
        function patchReplyPreview() {
            if (typeof window.updateReplyPreview !== 'function') return false;
            if (window.updateReplyPreview._voicePatched) return true;
            const original = window.updateReplyPreview;
            window.updateReplyPreview = function () {
                try {
                    if (typeof currentReplyTo !== 'undefined' && currentReplyTo && currentReplyTo.id) {
                        const m = findMessage(currentReplyTo.id);
                        if (m && m.voice && !currentReplyTo.text) {
                            const dur = m.voice.duration || 0;
                            currentReplyTo.text = `🔊 语音 ${dur}"`;
                        }
                    }
                } catch (e) {}
                return original.apply(this, arguments);
            };
            window.updateReplyPreview._voicePatched = true;
            return true;
        }
        // 项目脚本可能在我们后面才挂 updateReplyPreview，重试一下
        if (!patchReplyPreview()) {
            let tries = 0;
            const t = setInterval(() => {
                if (patchReplyPreview() || ++tries > 30) clearInterval(t);
            }, 200);
        }

        console.log('[voice] 语音模块已就绪');
    });
})();
