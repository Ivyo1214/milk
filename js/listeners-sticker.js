/* ────────────────────────────────────────────────────────────────
 * 首页改造 · 表情面板仿微信样式
 *   - tab 栏已通过 CSS 隐藏（隐藏整条 combo-tabs-header）
 *   - 这里负责：在 sticker grid 的首位插入"加号格子"（点击 = 上传新表情）
 *   - 沿用项目原有的 my-sticker-quick-upload input，逻辑不动
 * ──────────────────────────────────────────────────────────────── */
(function () {
    'use strict';

    function ready(fn) {
        if (document.readyState !== 'loading') {
            setTimeout(fn, 100);
        } else {
            document.addEventListener('DOMContentLoaded', () => setTimeout(fn, 100));
        }
    }

    ready(function init() {
        const contentArea = document.getElementById('combo-content-area');
        const uploadInput = document.getElementById('my-sticker-quick-upload');
        const picker = document.getElementById('user-sticker-picker');
        const inputArea = document.querySelector('.input-area');
        const inputAreaWrapper = document.querySelector('.input-area-wrapper');

        if (!contentArea || !uploadInput) {
            console.warn('[sticker] 元素未找到，跳过');
            return;
        }

        // DOM 重排：把 picker 从 input-area 里搬出来，放到 input-area-wrapper 的最前面
        // 这样 wrapper 用 column 布局后，picker 显示时会向上撑起 input-area
        if (picker && inputAreaWrapper && inputArea && picker.parentElement !== inputAreaWrapper) {
            inputAreaWrapper.insertBefore(picker, inputArea);
        }

        // 监听 grid 变化（用户切 tab、添加/删除表情时会 re-render）
        const observer = new MutationObserver(() => {
            injectAddButton();
        });
        observer.observe(contentArea, { childList: true, subtree: true });

        // 启动时也插一次
        injectAddButton();

        function injectAddButton() {
            // 决定要不要显示"添加表情"标题
            const hasEmptyTip = !!contentArea.querySelector('.empty-sticker-tip');
            const hasGrid = !!contentArea.querySelector('.sticker-grid-view');
            // 空状态（有 empty-tip）或不是表情 tab（没 grid 也没 tip，比如拍一拍）→ 不显示标题
            if (hasGrid && !hasEmptyTip) {
                contentArea.classList.add('show-title');
            } else {
                contentArea.classList.remove('show-title');
            }

            let grid = contentArea.querySelector('.sticker-grid-view');

            // 空表情库时，contentArea 只有 .empty-sticker-tip 没有 grid
            // 我们额外造一个 grid 并加进去，让用户依然可以点加号上传
            if (!grid) {
                const emptyTip = contentArea.querySelector('.empty-sticker-tip');
                if (!emptyTip) return;   // 当前可能在显示别的内容（如拍一拍 tab）
                // 已经塞过一次就不重复
                if (contentArea.querySelector('.sticker-grid-add')) return;

                grid = document.createElement('div');
                grid.className = 'sticker-grid-view';
                grid.style.marginTop = '12px';
                contentArea.appendChild(grid);
            }

            // 已经有加号按钮就不重复插
            if (grid.querySelector('.sticker-grid-add')) return;

            const addBtn = document.createElement('div');
            addBtn.className = 'sticker-grid-add';
            addBtn.title = '添加表情';
            addBtn.innerHTML = '<i class="fas fa-plus"></i>';
            addBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                uploadInput.click();
            });
            // 插到第一个位置
            grid.insertBefore(addBtn, grid.firstChild);
        }
    });
})();
