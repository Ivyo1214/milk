/* ────────────────────────────────────────────────────────────────
 * 首页改造 · 第二步：加号菜单 + 拍照 + 相册选择
 * 独立文件，不影响原有 listeners.js 逻辑。
 * 依赖：DOMElements.attachmentBtn（复用图片发送弹窗）、window.callFeature
 * ──────────────────────────────────────────────────────────────── */
(function () {
    'use strict';

    /** 等待 DOMElements 等核心对象准备好后再绑定 */
    function ready(fn) {
        if (document.readyState !== 'loading') {
            // 加一个微小延时，确保 listeners.js 的初始化先跑完
            setTimeout(fn, 50);
        } else {
            document.addEventListener('DOMContentLoaded', () => setTimeout(fn, 50));
        }
    }

    ready(function init() {
        const plusBtn       = document.getElementById('plus-btn');
        const plusMenu      = document.getElementById('plus-menu-popover');
        const albumInput    = document.getElementById('album-input');
        const voiceBtn      = document.getElementById('voice-btn');

        if (!plusBtn || !plusMenu) {
            console.warn('[step2] 加号菜单元素未找到，跳过初始化');
            return;
        }

        // ─────────── 1. 加号按钮：开关菜单 ───────────
        plusBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = plusMenu.classList.toggle('open');
            plusBtn.classList.toggle('active', isOpen);
        });

        // 点击菜单外部 → 关闭
        document.addEventListener('click', (e) => {
            if (plusMenu.classList.contains('open') &&
                !plusMenu.contains(e.target) &&
                e.target !== plusBtn &&
                !plusBtn.contains(e.target)) {
                plusMenu.classList.remove('open');
                plusBtn.classList.remove('active');
            }
        });

        // ─────────── 2. 菜单项分发 ───────────
        plusMenu.addEventListener('click', (e) => {
            const item = e.target.closest('.plus-menu-item');
            if (!item) return;
            const action = item.dataset.action;
            plusMenu.classList.remove('open');
            plusBtn.classList.remove('active');

            if (action === 'album') {
                albumInput.click();
            } else if (action === 'videocall') {
                if (window.callFeature && typeof window.callFeature.startCall === 'function') {
                    window.callFeature.startCall(false);
                } else {
                    notify('视频通话功能未就绪', 'error');
                }
            }
        });

        // ─────────── 3. 语音按钮（占位）───────────
        if (voiceBtn) {
            voiceBtn.addEventListener('click', () => {
                notify('语音功能开发中', 'info', 1500);
            });
        }

        // ─────────── 4. 相册选择（图片+视频）───────────
        albumInput.addEventListener('change', (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            // 重置 input，方便选同一个文件再发
            albumInput.value = '';

            if (file.type.startsWith('image/')) {
                handleImageFile(file);
            } else if (file.type.startsWith('video/')) {
                notify('视频消息功能尚未支持，敬请期待', 'warning', 2500);
                // 如果以后要支持发视频消息，在这里调用 sendVideoMessage(file)
            } else {
                notify('不支持的文件类型', 'error');
            }
        });

        // ─────────── 5. 辅助：把图片数据发送出去（复用项目内置流程）───────────

        /** 处理 File 对象（从相册选的）→ 优化 → 发送 */
        function handleImageFile(file) {
            // 优先复用项目里的 optimizeImage 和 MAX_IMAGE_SIZE
            const maxSize = (typeof MAX_IMAGE_SIZE !== 'undefined') ? MAX_IMAGE_SIZE : (5 * 1024 * 1024);
            if (file.size > maxSize) {
                notify('图片大小不能超过5MB', 'error');
                return;
            }
            notify('正在优化图片...', 'info', 1200);
            const optimizer = (typeof optimizeImage === 'function')
                ? optimizeImage(file)
                : readAsDataURL(file);
            Promise.resolve(optimizer)
                .then(dataUrl => sendImageData(dataUrl))
                .catch(() => notify('图片处理失败', 'error'));
        }

        function readAsDataURL(file) {
            return new Promise((resolve, reject) => {
                const r = new FileReader();
                r.onload  = () => resolve(r.result);
                r.onerror = () => reject(new Error('read fail'));
                r.readAsDataURL(file);
            });
        }

        /** 直接调用项目的 addMessage 发送图片（沿用 attachment-btn 内部用法）*/
        function sendImageData(dataUrl) {
            if (typeof addMessage !== 'function') {
                notify('发送函数未就绪', 'error');
                console.error('[step2] addMessage 函数不存在');
                return;
            }
            try {
                addMessage({
                    id: Date.now(),
                    sender: 'user',
                    text: '',
                    timestamp: new Date(),
                    image: dataUrl,
                    status: 'sent',
                    favorited: false,
                    note: null,
                    replyTo: (typeof currentReplyTo !== 'undefined') ? currentReplyTo : null,
                    type: 'normal'
                });
                if (typeof playSound === 'function') playSound('send');
                if (typeof currentReplyTo !== 'undefined') {
                    window.currentReplyTo = null;
                }
                if (typeof updateReplyPreview === 'function') updateReplyPreview();
                // 触发对方回复（沿用原有逻辑）
                if (typeof settings !== 'undefined' && typeof simulateReply === 'function') {
                    const range = (settings.replyDelayMax || 3000) - (settings.replyDelayMin || 1000);
                    const delay = (settings.replyDelayMin || 1000) + Math.random() * range;
                    setTimeout(simulateReply, delay);
                }
            } catch (err) {
                console.error('[step2] 发送图片失败:', err);
                notify('发送失败', 'error');
            }
        }

        function notify(text, type, duration) {
            if (typeof showNotification === 'function') {
                showNotification(text, type || 'info', duration || 2000);
            } else {
                console.log('[notify]', text);
            }
        }

        // ─────────── 7. 双击梦角头像 = 拍一拍 + 抖动动画 ───────────
        const partnerAvatar = document.getElementById('partner-avatar');
        if (partnerAvatar) {
            // 监听双击（dblclick 已经覆盖 PC 和移动端）
            partnerAvatar.addEventListener('dblclick', triggerPoke);

            // 移动端额外做一个手动的双击识别（防止部分浏览器 dblclick 触发不灵）
            let lastTap = 0;
            partnerAvatar.addEventListener('touchend', (e) => {
                const now = Date.now();
                if (now - lastTap < 350) {
                    e.preventDefault();
                    triggerPoke();
                }
                lastTap = now;
            });
        }

        function triggerPoke() {
            if (!partnerAvatar) return;

            // 1. 触发抖动动画（移除再加 class，确保连续双击也能重播）
            partnerAvatar.classList.remove('poking');
            void partnerAvatar.offsetWidth;   // 强制 reflow
            partnerAvatar.classList.add('poking');
            setTimeout(() => partnerAvatar.classList.remove('poking'), 600);

            // 2. 组装文案
            //   后续若设置里加了 myPokeText，这里改成：
            //   const text = settings.myPokeText?.trim() || defaultText;
            const myName      = (typeof settings !== 'undefined' && settings.myName)      ? settings.myName      : '我';
            const partnerName = (typeof settings !== 'undefined' && settings.partnerName) ? settings.partnerName : '梦角';
            let pokeText = `${myName} 拍了拍 ${partnerName}`;
            if (typeof window._sanitizePokeTextForDisplay === 'function') {
                pokeText = window._sanitizePokeTextForDisplay(pokeText);
            }
            const finalText = (typeof _formatPokeText === 'function')
                ? _formatPokeText(pokeText)
                : pokeText;

            // 3. 发送 system 类型消息（沿用项目原逻辑，跟原拍一拍弹窗一模一样）
            if (typeof addMessage !== 'function') {
                notify('发送函数未就绪', 'error');
                return;
            }
            addMessage({
                id: Date.now(),
                text: finalText,
                timestamp: new Date(),
                type: 'system'
            });

            // 4. 播放音效
            if (typeof playSound === 'function') playSound('poke');

            // 5. 触发对方回复（沿用原逻辑：随机延时）
            if (typeof simulateReply === 'function' && typeof settings !== 'undefined') {
                const range = (settings.replyDelayMax || 3000) - (settings.replyDelayMin || 1000);
                const delay = (settings.replyDelayMin || 1000) + Math.random() * range;
                setTimeout(simulateReply, delay);
            }
        }

        console.log('[step2] 加号菜单 + 拍照功能已就绪');
    });
})();
