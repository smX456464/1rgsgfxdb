// ==UserScript==
// @name         Pixiv 刮刮乐快捷跳转（分步双图选择）
// @namespace    https://www.pixiv.net/
// @version      3.1
// @description  在 Pixiv 作品图片上 Ctrl+Alt+右键，菜单选择单图模式，或分两步选择表图和里图后跳转刮刮乐（配置可调），支持自定义刮刮乐网址、使用说明书
// @author       smX456464
// @homepage     https://github.com/smX456464
// @supportURL   https://github.com/smX456464
// @match        https://www.pixiv.net/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @antifeature  adult-content  此脚本在包含成人内容的网站上运行 (Pixiv)
// @license      MIT
// ==/UserScript==

//单图实例图片
//https://pixiv.cat/144906874-2.jpg
//https://pixiv.cat/143949732-2.jpg
//https://pixiv.cat/143949732-1.jpg

(function() {
    'use strict';

    // -------------------- 配置（通过脚本菜单可调） --------------------
    const DEFAULT_BRUSH = 8;
    const DEFAULT_MAXPULL = 300;
    const DEFAULT_MODIFIERS = ['ctrl', 'alt'];
    const DEFAULT_SCRATCH_URL = 'https://mirumo-scratch-card.pages.dev/';

    let brushSize = GM_getValue('brushSize', DEFAULT_BRUSH);
    let maxPull = GM_getValue('maxPull', DEFAULT_MAXPULL);
    let triggerModifiers = GM_getValue('triggerModifiers', DEFAULT_MODIFIERS);
    // 自定义刮刮乐网址列表 [{url: string, enabled: boolean}]
    let customSites = GM_getValue('customSites', [{ url: DEFAULT_SCRATCH_URL, enabled: true }]);

    // 当前生效的刮刮乐基础URL（取第一个启用的站点，若没有则用默认）
    function getCurrentScratchUrl() {
        const enabledSites = customSites.filter(s => s.enabled);
        if (enabledSites.length > 0) {
            return enabledSites[0].url.replace(/\/+$/, ''); // 去除末尾斜杠
        }
        return DEFAULT_SCRATCH_URL;
    }

    // -------------------- 双图选择状态 --------------------
    let dualState = {
        baseUrl: null,     // 表图URL
        basePage: null,    // 表图页码（显示用）
        coverUrl: null,    // 里图URL
        coverPage: null,   // 里图页码
        illustId: null     // 作品ID
    };

    function resetDualState() {
        dualState = {
            baseUrl: null,
            basePage: null,
            coverUrl: null,
            coverPage: null,
            illustId: null
        };
        hideStatusToast();
    }

    // -------------------- 自定义右键菜单 --------------------
    let menu = null;
    let currentImgInfo = null;

    function createMenuDom() {
        menu = document.createElement('div');
        menu.id = 'pixiv-scratchcard-menu';
        Object.assign(menu.style, {
            position: 'fixed',
            background: '#2a2a2a',
            border: '1px solid #555',
            borderRadius: '6px',
            padding: '4px 0',
            zIndex: '999999',
            display: 'none',
            minWidth: '280px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            color: '#ddd',
            fontSize: '14px',
            fontFamily: 'Segoe UI, Arial, sans-serif'
        });
        document.body.appendChild(menu);
    }

    function clearMenu() {
        if (menu) menu.innerHTML = '';
    }

    function addItem(parent, text, onClick, hint = '') {
        const item = document.createElement('div');
        item.textContent = text;
        Object.assign(item.style, {
            padding: '8px 12px',
            cursor: 'pointer',
            transition: 'background 0.15s'
        });
        if (hint) item.title = hint;
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            onClick();
            hideMenu();
        });
        item.addEventListener('mouseenter', () => item.style.background = '#3a6ea5');
        item.addEventListener('mouseleave', () => item.style.background = '');
        parent.appendChild(item);
        return item;
    }

    function hideMenu() {
        if (menu) menu.style.display = 'none';
        currentImgInfo = null;
    }

    // 显示状态提示（表图已选择）
    let statusToast = null;
    function showStatusToast(message, isClickable = true) {
        if (!statusToast) {
            statusToast = document.createElement('div');
            Object.assign(statusToast.style, {
                position: 'fixed',
                bottom: '20px',
                right: '20px',
                background: 'rgba(0,0,0,0.8)',
                color: '#fff',
                padding: '10px 16px',
                borderRadius: '8px',
                zIndex: '9999999',
                fontSize: '14px',
                cursor: isClickable ? 'pointer' : 'default',
                pointerEvents: 'auto'
            });
            document.body.appendChild(statusToast);
        }
        statusToast.textContent = message;
        statusToast.style.display = 'block';
        statusToast.onclick = isClickable ? () => {
            resetDualState();
            showToast('双图选择已重置');
        } : null;
    }

    function hideStatusToast() {
        if (statusToast) {
            statusToast.style.display = 'none';
            statusToast.onclick = null;
        }
    }

    // 简单浮动提示
    function showToast(msg) {
        const toast = document.createElement('div');
        toast.textContent = msg;
        Object.assign(toast.style, {
            position: 'fixed',
            bottom: '80px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(0,0,0,0.8)',
            color: 'white',
            padding: '10px 20px',
            borderRadius: '4px',
            zIndex: '9999999',
            fontSize: '14px',
            pointerEvents: 'none'
        });
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2000);
    }

    // -------------------- 图片解析 --------------------
    function parseImageSrc(src) {
        const match = src.match(/\/(\d+)_p(\d+)_.*\.(jpg|png|gif|jpeg)/i);
        if (match) {
            return {
                illustId: match[1],
                pageIndex: parseInt(match[2], 10), // 0-based
                extension: match[3].toLowerCase()
            };
        }
        return null;
    }

    function buildCatUrl(illustId, pageIndex0, ext) {
        const pageNum = pageIndex0 + 1; // 1-based
        return `https://pixiv.cat/${illustId}-${pageNum}.${ext}`;
    }

    // -------------------- 单图跳转 --------------------
    function jumpSingle(catUrl) {
        const scratchBase = getCurrentScratchUrl();
        const params = `mode=sheet&split=vertical&brush=${brushSize}&maxpull=${maxPull}&lang=auto`;
        const url = `${scratchBase}/?${params}&source=${encodeURIComponent(catUrl)}`;
        window.open(url, '_blank');
    }

    // 双图跳转
    function jumpDual(coverUrl, baseUrl) {
        const scratchBase = getCurrentScratchUrl();
        const params = `mode=separate&split=vertical&brush=${brushSize}&maxpull=${maxPull}&lang=auto`;
        const url = `${scratchBase}/?${params}` +
                    `&img1=${encodeURIComponent(coverUrl)}&img1Role=cover` +
                    `&img2=${encodeURIComponent(baseUrl)}&img2Role=base`;
        window.open(url, '_blank');
    }

    // -------------------- 显示菜单 --------------------
    function showMenu(x, y, imgInfo) {
        if (!menu) createMenuDom();
        clearMenu();
        currentImgInfo = imgInfo;
        const { illustId, pageIndex, extension } = imgInfo;
        const catUrl = buildCatUrl(illustId, pageIndex, extension);
        const pageNum = pageIndex + 1;

        // 标题
        const title = document.createElement('div');
        title.textContent = '🎨 刮刮乐跳转';
        title.style.cssText = 'padding: 6px 12px; color: #aaa; font-weight: bold; border-bottom: 1px solid #444; margin-bottom: 2px;';
        menu.appendChild(title);

        // 单图模式
        addItem(menu, '📷 单图拼贴模式（当前图）', () => {
            resetDualState(); // 清空双图状态
            jumpSingle(catUrl);
        }, '使用当前图片作为拼贴图');

        // 双图模式（分步选择）
        let dualText, dualHint, dualAction;
        if (dualState.baseUrl) {
            // 已选表图，本次选择作为里图
            dualText = `🖼️ 双图模式：选择为里图（当前图 P${pageNum}）`;
            dualHint = `表图已选 P${dualState.basePage}，确认后将当前图设为里图`;
            dualAction = () => {
                dualState.coverUrl = catUrl;
                dualState.coverPage = pageNum;
                dualState.illustId = illustId;
                if (confirm(`是否跳转到刮刮乐？\n里图: P${dualState.coverPage}\n表图: P${dualState.basePage}`)) {
                    jumpDual(dualState.coverUrl, dualState.baseUrl);
                }
                resetDualState();
            };
        } else {
            dualText = `🖼️ 双图模式：选择为表图（当前图 P${pageNum}）`;
            dualHint = '将当前图片设为表图，然后再右键另一张图选择里图';
            dualAction = () => {
                dualState.baseUrl = catUrl;
                dualState.basePage = pageNum;
                dualState.illustId = illustId;
                dualState.coverUrl = null;
                dualState.coverPage = null;
                showStatusToast(`✅ 表图已选：P${pageNum}。请右键另一张图再次选择双图模式设为里图。点击此处可重置`);
                showToast('表图已记录，请选择里图');
            };
        }
        addItem(menu, dualText, dualAction, dualHint);

        // 如果已有表图，显示当前表图状态和重置选项
        if (dualState.baseUrl) {
            const separator = document.createElement('div');
            separator.style.cssText = 'border-top: 1px solid #444; margin: 4px 0;';
            menu.appendChild(separator);
            addItem(menu, `🗑️ 重置双图选择（当前表图: P${dualState.basePage}）`, () => {
                resetDualState();
                showToast('双图选择已重置');
            }, '取消已选的表图');
        }

        // 定位菜单
        menu.style.display = 'block';
        menu.style.left = Math.min(x, window.innerWidth - 300) + 'px';
        menu.style.top = Math.min(y, window.innerHeight - 180) + 'px';
    }

    // -------------------- 快捷键检测 --------------------
    function isArtworkImage(el) {
        return el.tagName === 'IMG' && el.src && el.src.includes('i.pximg.net');
    }

    function checkModifiers(e) {
        const modMap = {
            ctrl: e.ctrlKey,
            alt: e.altKey,
            shift: e.shiftKey,
            meta: e.metaKey
        };
        for (const mod of triggerModifiers) {
            if (!modMap[mod]) return false;
        }
        return true;
    }

    // -------------------- 事件绑定 --------------------
    document.addEventListener('contextmenu', function(e) {
        const img = e.target;
        if (isArtworkImage(img) && checkModifiers(e)) {
            e.preventDefault();
            const info = parseImageSrc(img.src);
            if (info) {
                showMenu(e.clientX, e.clientY, info);
            }
        } else {
            hideMenu();
        }
    }, true);

    document.addEventListener('click', (e) => {
        if (menu && !menu.contains(e.target)) hideMenu();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            hideMenu();
        }
    });

    window.addEventListener('scroll', hideMenu);
    window.addEventListener('resize', hideMenu);

    // ==================== 新增：载入网址管理界面 ====================
    function showSiteManager() {
        // 创建模态框
        const modal = document.createElement('div');
        modal.id = 'scratch-site-manager';
        Object.assign(modal.style, {
            position: 'fixed', top: '0', left: '0', width: '100%', height: '100%',
            background: 'rgba(0,0,0,0.7)', display: 'flex', justifyContent: 'center',
            alignItems: 'center', zIndex: '99999999'
        });
        const dialog = document.createElement('div');
        Object.assign(dialog.style, {
            background: '#2a2a2a', border: '1px solid #555', borderRadius: '8px',
            padding: '20px', minWidth: '500px', maxWidth: '700px', maxHeight: '80vh',
            overflowY: 'auto', color: '#ddd', fontSize: '14px', boxShadow: '0 4px 20px rgba(0,0,0,0.8)'
        });

        // 标题
        const title = document.createElement('h2');
        title.textContent = '🌐 自定义刮刮乐网址管理';
        title.style.cssText = 'margin: 0 0 15px 0; color: #fff;';
        dialog.appendChild(title);

        // 说明提示
        const hint = document.createElement('div');
        hint.style.cssText = 'background:#444;padding:8px 12px;border-radius:4px;margin-bottom:15px;font-size:12px;color:#aaa;';
        hint.innerHTML = `
            <b>通配符说明：</b>网址必须为完整的 <code>https://...</code> 开头，不支持通配符。<br>
            每个网址应对应同一个刮刮乐服务，支持参数：<code>mode</code>, <code>split</code>, <code>brush</code>, <code>maxpull</code>, <code>lang</code>, <code>source</code> 或 <code>img1</code>, <code>img2</code> 等。<br>
            列表按顺序使用，第一个<b>启用</b>的网址会被用于跳转。
        `;
        dialog.appendChild(hint);

        // 网址列表容器
        const listContainer = document.createElement('div');
        listContainer.style.cssText = 'margin-bottom: 15px;';

        function renderList() {
            listContainer.innerHTML = '';
            customSites.forEach((site, index) => {
                const item = document.createElement('div');
                item.style.cssText = 'display:flex; align-items:center; margin-bottom:6px; background:#333; padding:6px 10px; border-radius:4px;';
                // 启用/禁用复选框
                const enabledCheck = document.createElement('input');
                enabledCheck.type = 'checkbox';
                enabledCheck.checked = site.enabled;
                enabledCheck.style.marginRight = '10px';
                enabledCheck.title = '启用/禁用';
                enabledCheck.addEventListener('change', () => {
                    customSites[index].enabled = enabledCheck.checked;
                    GM_setValue('customSites', customSites);
                });
                item.appendChild(enabledCheck);

                // 网址文本
                const urlText = document.createElement('span');
                urlText.textContent = site.url;
                urlText.style.cssText = 'flex:1; word-break:break-all;';
                item.appendChild(urlText);

                // 删除按钮
                const delBtn = document.createElement('button');
                delBtn.textContent = '删除';
                delBtn.style.cssText = 'background:#a33; border:none; color:white; padding:4px 10px; border-radius:3px; cursor:pointer; margin-left:10px;';
                delBtn.addEventListener('click', () => {
                    if (confirm('确定删除该网址？')) {
                        customSites.splice(index, 1);
                        GM_setValue('customSites', customSites);
                        renderList();
                    }
                });
                item.appendChild(delBtn);
                listContainer.appendChild(item);
            });
        }
        renderList();
        dialog.appendChild(listContainer);

        // 添加新网址输入区域
        const addArea = document.createElement('div');
        addArea.style.cssText = 'display:flex; gap:10px; margin-bottom:15px;';
        const newUrlInput = document.createElement('input');
        newUrlInput.type = 'url';
        newUrlInput.placeholder = 'https://your-scratch-site.example.com';
        newUrlInput.style.cssText = 'flex:1; padding:6px 10px; border-radius:4px; border:1px solid #555; background:#222; color:#ddd;';
        const addBtn = document.createElement('button');
        addBtn.textContent = '添加';
        addBtn.style.cssText = 'background:#2a7; border:none; color:white; padding:6px 16px; border-radius:4px; cursor:pointer;';
        addBtn.addEventListener('click', () => {
            const newUrl = newUrlInput.value.trim();
            if (!newUrl.startsWith('https://')) {
                alert('网址必须以 https:// 开头');
                return;
            }
            // 检查是否已存在
            if (customSites.some(s => s.url === newUrl)) {
                alert('该网址已存在');
                return;
            }
            customSites.push({ url: newUrl, enabled: true });
            GM_setValue('customSites', customSites);
            newUrlInput.value = '';
            renderList();
        });
        addArea.appendChild(newUrlInput);
        addArea.appendChild(addBtn);
        dialog.appendChild(addArea);

        // 关闭按钮
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '关闭';
        closeBtn.style.cssText = 'background:#555; border:none; color:white; padding:8px 20px; border-radius:4px; cursor:pointer; float:right;';
        closeBtn.addEventListener('click', () => {
            document.body.removeChild(modal);
        });
        dialog.appendChild(closeBtn);

        modal.appendChild(dialog);
        document.body.appendChild(modal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) document.body.removeChild(modal);
        });
    }

    // ==================== 新增：使用说明书 ====================
    function showInstructions() {
        const modal = document.createElement('div');
        Object.assign(modal.style, {
            position: 'fixed', top: '0', left: '0', width: '100%', height: '100%',
            background: 'rgba(0,0,0,0.7)', display: 'flex', justifyContent: 'center',
            alignItems: 'center', zIndex: '99999999'
        });
        const dialog = document.createElement('div');
        Object.assign(dialog.style, {
            background: '#2a2a2a', border: '1px solid #555', borderRadius: '8px',
            padding: '20px', minWidth: '400px', maxWidth: '600px', maxHeight: '80vh',
            overflowY: 'auto', color: '#ddd', fontSize: '14px', boxShadow: '0 4px 20px rgba(0,0,0,0.8)'
        });

        const title = document.createElement('h2');
        title.textContent = '📖 使用说明书';
        title.style.cssText = 'margin: 0 0 15px 0; color: #fff;';
        dialog.appendChild(title);

        const content = document.createElement('div');
        content.innerHTML = `
            <h3>🎨 刮刮乐服务说明</h3>
            <p>本脚本默认使用 <a href="https://mirumo-scratch-card.pages.dev/" target="_blank" style="color:#6af;">mirumo-scratch-card.pages.dev</a> 提供的刮刮乐功能。</p>
            <h4>✅ 能做什么：</h4>
            <ul>
                <li>将任意 Pixiv 图片（拼贴图或两张独立图）制作成刮刮乐效果。</li>
                <li>自定义画笔大小、刮除力度，提供流畅的交互体验。</li>
                <li>支持直接通过图片 URL 生成刮刮乐，无需下载上传。</li>
            </ul>
            <h4>❌ 不能做什么：</h4>
            <ul>
                <li>不支持动图（Ugoira）的 ZIP 文件直接刮动，只能使用静态图。</li>
                <li>不能存储或保存您的刮开进度，每次打开都是全新的涂层。</li>
                <li>图片必须可公开访问，如果图片链接失效或需要登录，刮刮乐将无法加载图片。</li>
            </ul>
            <h4>⚙️ 如何正确使用：</h4>
            <ol>
                <li>在 Pixiv 作品页上，按住 <strong>Ctrl+Alt</strong>（默认）再右键点击任意作品图片。</li>
                <li>选择“单图拼贴模式”或“双图模式”逐步操作。</li>
                <li>如果需要自定义刮刮乐服务，通过 Tampermonkey 菜单 → “载入网址”添加你自己的站点。</li>
            </ol>
            <p style="color:#aaa; font-size:12px;">提示：自定义网址必须实现相同的 URL 参数接口，否则可能无法正常工作。</p>
        `;
        dialog.appendChild(content);

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '关闭';
        closeBtn.style.cssText = 'background:#555; border:none; color:white; padding:8px 20px; border-radius:4px; cursor:pointer; float:right; margin-top:10px;';
        closeBtn.addEventListener('click', () => {
            document.body.removeChild(modal);
        });
        dialog.appendChild(closeBtn);

        modal.appendChild(dialog);
        document.body.appendChild(modal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) document.body.removeChild(modal);
        });
    }

    // -------------------- Tampermonkey 配置菜单（含原有 + 新增）--------------------
    function registerConfigMenus() {
        // --- 原有菜单 ---
        GM_registerMenuCommand(`🎨 画笔大小 (${brushSize})`, () => {
            const val = prompt('画笔相对比例 (1-40，默认8)', brushSize);
            if (val !== null) {
                const n = parseFloat(val);
                if (n > 0 && n <= 40) {
                    brushSize = n;
                    GM_setValue('brushSize', n);
                    alert('画笔大小已更新，刷新页面后菜单标题更新');
                }
            }
        });
        GM_registerMenuCommand(`💪 擦除力度 (${maxPull})`, () => {
            const val = prompt('拉动行程上限 px (100-1000，默认300)', maxPull);
            if (val !== null) {
                const n = parseInt(val, 10);
                if (n >= 100 && n <= 1000) {
                    maxPull = n;
                    GM_setValue('maxPull', n);
                    alert('擦除力度已更新');
                }
            }
        });
        const currentKeys = triggerModifiers.join('+');
        GM_registerMenuCommand(`⌨️ 快捷键 (${currentKeys})`, () => {
            const input = prompt('修饰键组合，用逗号或加号分隔。可用键：ctrl, alt, shift, meta\n例如：ctrl,alt', currentKeys);
            if (input) {
                const keys = input.split(/[,+]+/).map(s => s.trim().toLowerCase()).filter(k => k);
                const valid = ['ctrl','alt','shift','meta'];
                const filtered = keys.filter(k => valid.includes(k));
                if (filtered.length > 0) {
                    triggerModifiers = filtered;
                    GM_setValue('triggerModifiers', filtered);
                    alert('快捷键已更新为 ' + filtered.join('+'));
                }
            }
        });

        // --- 新增一级菜单：载入网址 ---
        GM_registerMenuCommand('🌐 载入网址', () => {
            showSiteManager();
        });

        // --- 新增一级菜单：使用说明书 ---
        GM_registerMenuCommand('📖 使用说明书', () => {
            showInstructions();
        });
    }
    registerConfigMenus();

    // 初始时若已有表图状态残留（跨页面刷新不会保留，但可清除）
    resetDualState();

})();

(function() {
    'use strict';

    // -------------------- 配置（通过脚本菜单可调） --------------------
    const DEFAULT_BRUSH = 8;
    const DEFAULT_MAXPULL = 300;
    const DEFAULT_MODIFIERS = ['ctrl', 'alt'];
    const DEFAULT_SCRATCH_URL = 'https://mirumo-scratch-card.pages.dev/';

    let brushSize = GM_getValue('brushSize', DEFAULT_BRUSH);
    let maxPull = GM_getValue('maxPull', DEFAULT_MAXPULL);
    let triggerModifiers = GM_getValue('triggerModifiers', DEFAULT_MODIFIERS);
    // 自定义刮刮乐网址列表 [{url: string, enabled: boolean}]
    let customSites = GM_getValue('customSites', [{ url: DEFAULT_SCRATCH_URL, enabled: true }]);

    // 当前生效的刮刮乐基础URL（取第一个启用的站点，若没有则用默认）
    function getCurrentScratchUrl() {
        const enabledSites = customSites.filter(s => s.enabled);
        if (enabledSites.length > 0) {
            return enabledSites[0].url.replace(/\/+$/, ''); // 去除末尾斜杠
        }
        return DEFAULT_SCRATCH_URL;
    }

    // -------------------- 双图选择状态 --------------------
    let dualState = {
        baseUrl: null,     // 表图URL
        basePage: null,    // 表图页码（显示用）
        coverUrl: null,    // 里图URL
        coverPage: null,   // 里图页码
        illustId: null     // 作品ID
    };

    function resetDualState() {
        dualState = {
            baseUrl: null,
            basePage: null,
            coverUrl: null,
            coverPage: null,
            illustId: null
        };
        hideStatusToast();
    }

    // -------------------- 自定义右键菜单 --------------------
    let menu = null;
    let currentImgInfo = null;

    function createMenuDom() {
        menu = document.createElement('div');
        menu.id = 'pixiv-scratchcard-menu';
        Object.assign(menu.style, {
            position: 'fixed',
            background: '#2a2a2a',
            border: '1px solid #555',
            borderRadius: '6px',
            padding: '4px 0',
            zIndex: '999999',
            display: 'none',
            minWidth: '280px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            color: '#ddd',
            fontSize: '14px',
            fontFamily: 'Segoe UI, Arial, sans-serif'
        });
        document.body.appendChild(menu);
    }

    function clearMenu() {
        if (menu) menu.innerHTML = '';
    }

    function addItem(parent, text, onClick, hint = '') {
        const item = document.createElement('div');
        item.textContent = text;
        Object.assign(item.style, {
            padding: '8px 12px',
            cursor: 'pointer',
            transition: 'background 0.15s'
        });
        if (hint) item.title = hint;
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            onClick();
            hideMenu();
        });
        item.addEventListener('mouseenter', () => item.style.background = '#3a6ea5');
        item.addEventListener('mouseleave', () => item.style.background = '');
        parent.appendChild(item);
        return item;
    }

    function hideMenu() {
        if (menu) menu.style.display = 'none';
        currentImgInfo = null;
    }

    // 显示状态提示（表图已选择）
    let statusToast = null;
    function showStatusToast(message, isClickable = true) {
        if (!statusToast) {
            statusToast = document.createElement('div');
            Object.assign(statusToast.style, {
                position: 'fixed',
                bottom: '20px',
                right: '20px',
                background: 'rgba(0,0,0,0.8)',
                color: '#fff',
                padding: '10px 16px',
                borderRadius: '8px',
                zIndex: '9999999',
                fontSize: '14px',
                cursor: isClickable ? 'pointer' : 'default',
                pointerEvents: 'auto'
            });
            document.body.appendChild(statusToast);
        }
        statusToast.textContent = message;
        statusToast.style.display = 'block';
        statusToast.onclick = isClickable ? () => {
            resetDualState();
            showToast('双图选择已重置');
        } : null;
    }

    function hideStatusToast() {
        if (statusToast) {
            statusToast.style.display = 'none';
            statusToast.onclick = null;
        }
    }

    // 简单浮动提示
    function showToast(msg) {
        const toast = document.createElement('div');
        toast.textContent = msg;
        Object.assign(toast.style, {
            position: 'fixed',
            bottom: '80px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(0,0,0,0.8)',
            color: 'white',
            padding: '10px 20px',
            borderRadius: '4px',
            zIndex: '9999999',
            fontSize: '14px',
            pointerEvents: 'none'
        });
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2000);
    }

    // -------------------- 图片解析 --------------------
    function parseImageSrc(src) {
        const match = src.match(/\/(\d+)_p(\d+)_.*\.(jpg|png|gif|jpeg)/i);
        if (match) {
            return {
                illustId: match[1],
                pageIndex: parseInt(match[2], 10), // 0-based
                extension: match[3].toLowerCase()
            };
        }
        return null;
    }

    function buildCatUrl(illustId, pageIndex0, ext) {
        const pageNum = pageIndex0 + 1; // 1-based
        return `https://pixiv.cat/${illustId}-${pageNum}.${ext}`;
    }

    // -------------------- 单图跳转 --------------------
    function jumpSingle(catUrl) {
        const scratchBase = getCurrentScratchUrl();
        const params = `mode=sheet&split=vertical&brush=${brushSize}&maxpull=${maxPull}&lang=auto`;
        const url = `${scratchBase}/?${params}&source=${encodeURIComponent(catUrl)}`;
        window.open(url, '_blank');
    }

    // 双图跳转
    function jumpDual(coverUrl, baseUrl) {
        const scratchBase = getCurrentScratchUrl();
        const params = `mode=separate&split=vertical&brush=${brushSize}&maxpull=${maxPull}&lang=auto`;
        const url = `${scratchBase}/?${params}` +
                    `&img1=${encodeURIComponent(coverUrl)}&img1Role=cover` +
                    `&img2=${encodeURIComponent(baseUrl)}&img2Role=base`;
        window.open(url, '_blank');
    }

    // -------------------- 显示菜单 --------------------
    function showMenu(x, y, imgInfo) {
        if (!menu) createMenuDom();
        clearMenu();
        currentImgInfo = imgInfo;
        const { illustId, pageIndex, extension } = imgInfo;
        const catUrl = buildCatUrl(illustId, pageIndex, extension);
        const pageNum = pageIndex + 1;

        // 标题
        const title = document.createElement('div');
        title.textContent = '🎨 刮刮乐跳转';
        title.style.cssText = 'padding: 6px 12px; color: #aaa; font-weight: bold; border-bottom: 1px solid #444; margin-bottom: 2px;';
        menu.appendChild(title);

        // 单图模式
        addItem(menu, '📷 单图拼贴模式（当前图）', () => {
            resetDualState(); // 清空双图状态
            jumpSingle(catUrl);
        }, '使用当前图片作为拼贴图');

        // 双图模式（分步选择）
        let dualText, dualHint, dualAction;
        if (dualState.baseUrl) {
            // 已选表图，本次选择作为里图
            dualText = `🖼️ 双图模式：选择为里图（当前图 P${pageNum}）`;
            dualHint = `表图已选 P${dualState.basePage}，确认后将当前图设为里图`;
            dualAction = () => {
                dualState.coverUrl = catUrl;
                dualState.coverPage = pageNum;
                dualState.illustId = illustId;
                if (confirm(`是否跳转到刮刮乐？\n里图: P${dualState.coverPage}\n表图: P${dualState.basePage}`)) {
                    jumpDual(dualState.coverUrl, dualState.baseUrl);
                }
                resetDualState();
            };
        } else {
            dualText = `🖼️ 双图模式：选择为表图（当前图 P${pageNum}）`;
            dualHint = '将当前图片设为表图，然后再右键另一张图选择里图';
            dualAction = () => {
                dualState.baseUrl = catUrl;
                dualState.basePage = pageNum;
                dualState.illustId = illustId;
                dualState.coverUrl = null;
                dualState.coverPage = null;
                showStatusToast(`✅ 表图已选：P${pageNum}。请右键另一张图再次选择双图模式设为里图。点击此处可重置`);
                showToast('表图已记录，请选择里图');
            };
        }
        addItem(menu, dualText, dualAction, dualHint);

        // 如果已有表图，显示当前表图状态和重置选项
        if (dualState.baseUrl) {
            const separator = document.createElement('div');
            separator.style.cssText = 'border-top: 1px solid #444; margin: 4px 0;';
            menu.appendChild(separator);
            addItem(menu, `🗑️ 重置双图选择（当前表图: P${dualState.basePage}）`, () => {
                resetDualState();
                showToast('双图选择已重置');
            }, '取消已选的表图');
        }

        // 定位菜单
        menu.style.display = 'block';
        menu.style.left = Math.min(x, window.innerWidth - 300) + 'px';
        menu.style.top = Math.min(y, window.innerHeight - 180) + 'px';
    }

    // -------------------- 快捷键检测 --------------------
    function isArtworkImage(el) {
        return el.tagName === 'IMG' && el.src && el.src.includes('i.pximg.net');
    }

    function checkModifiers(e) {
        const modMap = {
            ctrl: e.ctrlKey,
            alt: e.altKey,
            shift: e.shiftKey,
            meta: e.metaKey
        };
        for (const mod of triggerModifiers) {
            if (!modMap[mod]) return false;
        }
        return true;
    }

    // -------------------- 事件绑定 --------------------
    document.addEventListener('contextmenu', function(e) {
        const img = e.target;
        if (isArtworkImage(img) && checkModifiers(e)) {
            e.preventDefault();
            const info = parseImageSrc(img.src);
            if (info) {
                showMenu(e.clientX, e.clientY, info);
            }
        } else {
            hideMenu();
        }
    }, true);

    document.addEventListener('click', (e) => {
        if (menu && !menu.contains(e.target)) hideMenu();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            hideMenu();
        }
    });

    window.addEventListener('scroll', hideMenu);
    window.addEventListener('resize', hideMenu);

    // ==================== 新增：载入网址管理界面 ====================
    function showSiteManager() {
        // 创建模态框
        const modal = document.createElement('div');
        modal.id = 'scratch-site-manager';
        Object.assign(modal.style, {
            position: 'fixed', top: '0', left: '0', width: '100%', height: '100%',
            background: 'rgba(0,0,0,0.7)', display: 'flex', justifyContent: 'center',
            alignItems: 'center', zIndex: '99999999'
        });
        const dialog = document.createElement('div');
        Object.assign(dialog.style, {
            background: '#2a2a2a', border: '1px solid #555', borderRadius: '8px',
            padding: '20px', minWidth: '500px', maxWidth: '700px', maxHeight: '80vh',
            overflowY: 'auto', color: '#ddd', fontSize: '14px', boxShadow: '0 4px 20px rgba(0,0,0,0.8)'
        });

        // 标题
        const title = document.createElement('h2');
        title.textContent = '🌐 自定义刮刮乐网址管理';
        title.style.cssText = 'margin: 0 0 15px 0; color: #fff;';
        dialog.appendChild(title);

        // 说明提示
        const hint = document.createElement('div');
        hint.style.cssText = 'background:#444;padding:8px 12px;border-radius:4px;margin-bottom:15px;font-size:12px;color:#aaa;';
        hint.innerHTML = `
            <b>通配符说明：</b>网址必须为完整的 <code>https://...</code> 开头，不支持通配符。<br>
            每个网址应对应同一个刮刮乐服务，支持参数：<code>mode</code>, <code>split</code>, <code>brush</code>, <code>maxpull</code>, <code>lang</code>, <code>source</code> 或 <code>img1</code>, <code>img2</code> 等。<br>
            列表按顺序使用，第一个<b>启用</b>的网址会被用于跳转。
        `;
        dialog.appendChild(hint);

        // 网址列表容器
        const listContainer = document.createElement('div');
        listContainer.style.cssText = 'margin-bottom: 15px;';

        function renderList() {
            listContainer.innerHTML = '';
            customSites.forEach((site, index) => {
                const item = document.createElement('div');
                item.style.cssText = 'display:flex; align-items:center; margin-bottom:6px; background:#333; padding:6px 10px; border-radius:4px;';
                // 启用/禁用复选框
                const enabledCheck = document.createElement('input');
                enabledCheck.type = 'checkbox';
                enabledCheck.checked = site.enabled;
                enabledCheck.style.marginRight = '10px';
                enabledCheck.title = '启用/禁用';
                enabledCheck.addEventListener('change', () => {
                    customSites[index].enabled = enabledCheck.checked;
                    GM_setValue('customSites', customSites);
                });
                item.appendChild(enabledCheck);

                // 网址文本
                const urlText = document.createElement('span');
                urlText.textContent = site.url;
                urlText.style.cssText = 'flex:1; word-break:break-all;';
                item.appendChild(urlText);

                // 删除按钮
                const delBtn = document.createElement('button');
                delBtn.textContent = '删除';
                delBtn.style.cssText = 'background:#a33; border:none; color:white; padding:4px 10px; border-radius:3px; cursor:pointer; margin-left:10px;';
                delBtn.addEventListener('click', () => {
                    if (confirm('确定删除该网址？')) {
                        customSites.splice(index, 1);
                        GM_setValue('customSites', customSites);
                        renderList();
                    }
                });
                item.appendChild(delBtn);
                listContainer.appendChild(item);
            });
        }
        renderList();
        dialog.appendChild(listContainer);

        // 添加新网址输入区域
        const addArea = document.createElement('div');
        addArea.style.cssText = 'display:flex; gap:10px; margin-bottom:15px;';
        const newUrlInput = document.createElement('input');
        newUrlInput.type = 'url';
        newUrlInput.placeholder = 'https://your-scratch-site.example.com';
        newUrlInput.style.cssText = 'flex:1; padding:6px 10px; border-radius:4px; border:1px solid #555; background:#222; color:#ddd;';
        const addBtn = document.createElement('button');
        addBtn.textContent = '添加';
        addBtn.style.cssText = 'background:#2a7; border:none; color:white; padding:6px 16px; border-radius:4px; cursor:pointer;';
        addBtn.addEventListener('click', () => {
            const newUrl = newUrlInput.value.trim();
            if (!newUrl.startsWith('https://')) {
                alert('网址必须以 https:// 开头');
                return;
            }
            // 检查是否已存在
            if (customSites.some(s => s.url === newUrl)) {
                alert('该网址已存在');
                return;
            }
            customSites.push({ url: newUrl, enabled: true });
            GM_setValue('customSites', customSites);
            newUrlInput.value = '';
            renderList();
        });
        addArea.appendChild(newUrlInput);
        addArea.appendChild(addBtn);
        dialog.appendChild(addArea);

        // 关闭按钮
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '关闭';
        closeBtn.style.cssText = 'background:#555; border:none; color:white; padding:8px 20px; border-radius:4px; cursor:pointer; float:right;';
        closeBtn.addEventListener('click', () => {
            document.body.removeChild(modal);
        });
        dialog.appendChild(closeBtn);

        modal.appendChild(dialog);
        document.body.appendChild(modal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) document.body.removeChild(modal);
        });
    }

    // ==================== 新增：使用说明书 ====================
    function showInstructions() {
        const modal = document.createElement('div');
        Object.assign(modal.style, {
            position: 'fixed', top: '0', left: '0', width: '100%', height: '100%',
            background: 'rgba(0,0,0,0.7)', display: 'flex', justifyContent: 'center',
            alignItems: 'center', zIndex: '99999999'
        });
        const dialog = document.createElement('div');
        Object.assign(dialog.style, {
            background: '#2a2a2a', border: '1px solid #555', borderRadius: '8px',
            padding: '20px', minWidth: '400px', maxWidth: '600px', maxHeight: '80vh',
            overflowY: 'auto', color: '#ddd', fontSize: '14px', boxShadow: '0 4px 20px rgba(0,0,0,0.8)'
        });

        const title = document.createElement('h2');
        title.textContent = '📖 使用说明书';
        title.style.cssText = 'margin: 0 0 15px 0; color: #fff;';
        dialog.appendChild(title);

        const content = document.createElement('div');
        content.innerHTML = `
            <h3>🎨 刮刮乐服务说明</h3>
            <p>本脚本默认使用 <a href="https://mirumo-scratch-card.pages.dev/" target="_blank" style="color:#6af;">mirumo-scratch-card.pages.dev</a> 提供的刮刮乐功能。</p>
            <h4>✅ 能做什么：</h4>
            <ul>
                <li>将任意 Pixiv 图片（拼贴图或两张独立图）制作成刮刮乐效果。</li>
                <li>自定义画笔大小、刮除力度，提供流畅的交互体验。</li>
                <li>支持直接通过图片 URL 生成刮刮乐，无需下载上传。</li>
            </ul>
            <h4>❌ 不能做什么：</h4>
            <ul>
                <li>不支持动图（Ugoira）的 ZIP 文件直接刮动，只能使用静态图。</li>
                <li>不能存储或保存您的刮开进度，每次打开都是全新的涂层。</li>
                <li>图片必须可公开访问，如果图片链接失效或需要登录，刮刮乐将无法加载图片。</li>
            </ul>
            <h4>⚙️ 如何正确使用：</h4>
            <ol>
                <li>在 Pixiv 作品页上，按住 <strong>Ctrl+Alt</strong>（默认）再右键点击任意作品图片。</li>
                <li>选择“单图拼贴模式”或“双图模式”逐步操作。</li>
                <li>如果需要自定义刮刮乐服务，通过 Tampermonkey 菜单 → “载入网址”添加你自己的站点。</li>
            </ol>
            <p style="color:#aaa; font-size:12px;">提示：自定义网址必须实现相同的 URL 参数接口，否则可能无法正常工作。</p>
        `;
        dialog.appendChild(content);

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '关闭';
        closeBtn.style.cssText = 'background:#555; border:none; color:white; padding:8px 20px; border-radius:4px; cursor:pointer; float:right; margin-top:10px;';
        closeBtn.addEventListener('click', () => {
            document.body.removeChild(modal);
        });
        dialog.appendChild(closeBtn);

        modal.appendChild(dialog);
        document.body.appendChild(modal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) document.body.removeChild(modal);
        });
    }

    // -------------------- Tampermonkey 配置菜单（含原有 + 新增）--------------------
    function registerConfigMenus() {
        // --- 原有菜单 ---
        GM_registerMenuCommand(`🎨 画笔大小 (${brushSize})`, () => {
            const val = prompt('画笔相对比例 (1-40，默认8)', brushSize);
            if (val !== null) {
                const n = parseFloat(val);
                if (n > 0 && n <= 40) {
                    brushSize = n;
                    GM_setValue('brushSize', n);
                    alert('画笔大小已更新，刷新页面后菜单标题更新');
                }
            }
        });
        GM_registerMenuCommand(`💪 擦除力度 (${maxPull})`, () => {
            const val = prompt('拉动行程上限 px (100-1000，默认300)', maxPull);
            if (val !== null) {
                const n = parseInt(val, 10);
                if (n >= 100 && n <= 1000) {
                    maxPull = n;
                    GM_setValue('maxPull', n);
                    alert('擦除力度已更新');
                }
            }
        });
        const currentKeys = triggerModifiers.join('+');
        GM_registerMenuCommand(`⌨️ 快捷键 (${currentKeys})`, () => {
            const input = prompt('修饰键组合，用逗号或加号分隔。可用键：ctrl, alt, shift, meta\n例如：ctrl,alt', currentKeys);
            if (input) {
                const keys = input.split(/[,+]+/).map(s => s.trim().toLowerCase()).filter(k => k);
                const valid = ['ctrl','alt','shift','meta'];
                const filtered = keys.filter(k => valid.includes(k));
                if (filtered.length > 0) {
                    triggerModifiers = filtered;
                    GM_setValue('triggerModifiers', filtered);
                    alert('快捷键已更新为 ' + filtered.join('+'));
                }
            }
        });

        // --- 新增一级菜单：载入网址 ---
        GM_registerMenuCommand('🌐 载入网址', () => {
            showSiteManager();
        });

        // --- 新增一级菜单：使用说明书 ---
        GM_registerMenuCommand('📖 使用说明书', () => {
            showInstructions();
        });
    }
    registerConfigMenus();

    // 初始时若已有表图状态残留（跨页面刷新不会保留，但可清除）
    resetDualState();

})();