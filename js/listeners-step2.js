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
            showRecorder();
            startTimer();
            startWaveAnimation();
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
                    sendVoiceMessage(dataUrl, duration);
                } catch (e) {
                    console.error('[voice] base64 转换失败', e);
                    notify('发送失败', 'error');
                }
            }
            // cancel 不做任何发送
            cleanup();
        }

        // ─────────── 发送语音消息（沿用 addMessage 流程）───────────
        function sendVoiceMessage(dataUrl, duration) {
            if (typeof addMessage !== 'function') {
                notify('发送函数未就绪', 'error');
                return;
            }
            addMessage({
                id: Date.now(),
                sender: 'user',
                text: '',
                timestamp: new Date(),
                voice: { url: dataUrl, duration: duration },
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
        const chatContainer = document.getElementById('chat-container');
        if (chatContainer) {
            const observer = new MutationObserver((mutations) => {
                mutations.forEach((m) => {
                    m.addedNodes.forEach((node) => {
                        if (!(node instanceof HTMLElement)) return;
                        if (node.classList && node.classList.contains('message-wrapper')) {
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
            // 找到消息数据
            const msg = findMessage(msgId);
            if (!msg || !msg.voice || !msg.voice.url) return;
            if (wrapper.dataset.voiceRendered === '1') return;
            wrapper.dataset.voiceRendered = '1';

            const bubble = wrapper.querySelector('.message');
            if (!bubble) return;

            // 清空气泡原内容，塞入语音气泡
            const duration = msg.voice.duration || 0;
            const bars = Array.from({ length: 8 }, () =>
                `<span style="width:2px;height:${30 + Math.random() * 50}%;"></span>`
            ).join('');
            bubble.innerHTML = `
                <div class="voice-bubble" data-voice-url="${escapeAttr(msg.voice.url)}" data-duration="${duration}">
                    <span class="voice-bubble-icon"><i class="fas fa-volume-up"></i></span>
                    <span class="voice-bubble-bars">${bars}</span>
                    <span class="voice-bubble-duration">${duration}"</span>
                </div>
            `;
        }

        function findMessage(id) {
            if (typeof messages === 'undefined' || !Array.isArray(messages)) return null;
            return messages.find(m => String(m.id) === String(id));
        }

        function escapeAttr(s) {
            return String(s).replace(/"/g, '&quot;');
        }

        // 点击语音气泡播放（事件委托）
        let currentAudio = null;
        let currentBubble = null;
        document.body.addEventListener('click', (e) => {
            const bubble = e.target.closest('.voice-bubble');
            if (!bubble) return;
            const url = bubble.dataset.voiceUrl;
            if (!url) return;

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
        });

        console.log('[voice] 语音模块已就绪');
    });
})();
