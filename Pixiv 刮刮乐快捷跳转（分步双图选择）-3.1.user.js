// ==UserScript==
// @name         Pixiv 刮刮乐快捷跳转（分步双图选择 + 独立模式配置）
// @namespace    https://www.pixiv.net/
// @version      3.7
// @description  在 Pixiv 作品图片上 Ctrl+Alt+右键，菜单选择单图拼贴/单图纯色/双图模式，每种模式独立画笔/力度，涂层颜色内置。支持本地刮刮乐文件（自动复制链接）。
// @author       smX456464
// @homepage     https://github.com/smX456464
// @supportURL   https://github.com/smX456464
// @match        https://www.pixiv.net/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @antifeature  adult-content  此脚本在包含成人内容的网站上运行 (Pixiv)
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';

    // ==================== 默认配置 ====================
    const DEFAULT_BRUSH = 8;
    const DEFAULT_MAXPULL = 300;
    const DEFAULT_MODIFIERS = ['ctrl', 'alt'];
    const DEFAULT_SCRATCH_URL = 'https://mirumo-scratch-card.pages.dev/';
    const DEFAULT_SOLID_COLOR = '白色';

    const SOLID_COLOR_MAP = {
        '白色': '#FFFFFF',
        '黑色': '#000000',
        '灰色': '#808080',
        '红色': '#FF0000',
        '橙色': '#FFA500',
        '黄色': '#FFFF00',
        '绿色': '#008000',
        '蓝色': '#0000FF',
        '靛色': '#4B0082',
        '紫色': '#800080'
    };

    const solidDataUrlCache = {};

    // ==================== 独立模式参数存储 ====================
    let brushSheet = GM_getValue('brushSheet', DEFAULT_BRUSH);
    let maxPullSheet = GM_getValue('maxPullSheet', DEFAULT_MAXPULL);

    let brushSolid = GM_getValue('brushSolid', DEFAULT_BRUSH);
    let maxPullSolid = GM_getValue('maxPullSolid', DEFAULT_MAXPULL);

    let brushDual = GM_getValue('brushDual', DEFAULT_BRUSH);
    let maxPullDual = GM_getValue('maxPullDual', DEFAULT_MAXPULL);

    let triggerModifiers = GM_getValue('triggerModifiers', DEFAULT_MODIFIERS);
    let customSites = GM_getValue('customSites', [{ url: DEFAULT_SCRATCH_URL, enabled: true }]);
    let solidColorName = GM_getValue('solidColor', DEFAULT_SOLID_COLOR);

    // 当前生效的刮刮乐基础 URL
    function getCurrentScratchUrl() {
        const enabled = customSites.filter(s => s.enabled);
        const url = enabled.length > 0 ? enabled[0].url.replace(/\/+$/, '') : DEFAULT_SCRATCH_URL;
        console.log('[刮刮乐脚本] 当前使用的刮刮乐网址:', url);
        return url;
    }

    // 生成指定尺寸的纯色 dataURL
    function getSolidColorDataUrl(colorName, width, height) {
        const key = `${colorName}_${width}x${height}`;
        if (solidDataUrlCache[key]) return solidDataUrlCache[key];
        const hex = SOLID_COLOR_MAP[colorName] || '#FFFFFF';
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = hex;
        ctx.fillRect(0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/png');
        solidDataUrlCache[key] = dataUrl;
        return dataUrl;
    }

    // ==================== 通用打开或复制函数（增强版）====================
    function openOrCopy(url) {
        console.log('[刮刮乐脚本] 目标URL:', url);
        // 检测本地路径
        if (url.startsWith('file://') || url.includes('://localhost')) {
            console.log('[刮刮乐脚本] 检测到本地路径，复制到剪贴板...');
            // 优先使用 navigator.clipboard.writeText（标准 API）
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(url).then(() => {
                    alert('✅ 已复制链接到剪贴板！\n请手动粘贴到浏览器地址栏打开。\n\n' + url);
                }).catch(() => {
                    // 如果失败，用 GM_setClipboard 回退
                    try {
                        GM_setClipboard(url, 'text');
                        alert('✅ 已复制链接到剪贴板！\n请手动粘贴到浏览器地址栏打开。\n\n' + url);
                    } catch (e) {
                        // 最后用 prompt 兜底
                        prompt('⚠️ 自动复制失败，请手动复制以下链接:', url);
                    }
                });
            } else {
                // 没有 clipboard API，直接用 GM 或 prompt
                try {
                    GM_setClipboard(url, 'text');
                    alert('✅ 已复制链接到剪贴板！\n请手动粘贴到浏览器地址栏打开。\n\n' + url);
                } catch (e) {
                    prompt('⚠️ 自动复制失败，请手动复制以下链接:', url);
                }
            }
            return;
        }
        // 远程链接正常跳转
        window.open(url, '_blank');
    }

    // ==================== 双图选择状态 ====================
    let dualState = {
        baseUrl: null,
        basePage: null,
        coverUrl: null,
        coverPage: null,
        illustId: null
    };

    function resetDualState() {
        dualState = { baseUrl: null, basePage: null, coverUrl: null, coverPage: null, illustId: null };
        hideStatusToast();
    }

    // ==================== 自定义右键菜单 ====================
    let menu = null;
    let currentImgInfo = null;
    let currentImgNaturalWidth = 0;
    let currentImgNaturalHeight = 0;

    function createMenuDom() {
        menu = document.createElement('div');
        menu.id = 'pixiv-scratchcard-menu';
        Object.assign(menu.style, {
            position: 'fixed', background: '#2a2a2a', border: '1px solid #555',
            borderRadius: '6px', padding: '4px 0', zIndex: '999999', display: 'none',
            minWidth: '280px', boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            color: '#ddd', fontSize: '14px', fontFamily: 'Segoe UI, Arial, sans-serif'
        });
        document.body.appendChild(menu);
    }

    function clearMenu() { if (menu) menu.innerHTML = ''; }

    function addItem(parent, text, onClick, hint = '') {
        const item = document.createElement('div');
        item.textContent = text;
        Object.assign(item.style, { padding: '8px 12px', cursor: 'pointer', transition: 'background 0.15s' });
        if (hint) item.title = hint;
        item.addEventListener('click', (e) => { e.stopPropagation(); onClick(); hideMenu(); });
        item.addEventListener('mouseenter', () => item.style.background = '#3a6ea5');
        item.addEventListener('mouseleave', () => item.style.background = '');
        parent.appendChild(item);
    }

    function hideMenu() {
        if (menu) menu.style.display = 'none';
        currentImgInfo = null;
        currentImgNaturalWidth = 0;
        currentImgNaturalHeight = 0;
    }

    // 状态提示 Toast
    let statusToast = null;
    function showStatusToast(msg, clickable = true) {
        if (!statusToast) {
            statusToast = document.createElement('div');
            Object.assign(statusToast.style, {
                position: 'fixed', bottom: '20px', right: '20px', background: 'rgba(0,0,0,0.8)',
                color: '#fff', padding: '10px 16px', borderRadius: '8px', zIndex: '9999999',
                fontSize: '14px', cursor: 'pointer', pointerEvents: 'auto'
            });
            document.body.appendChild(statusToast);
        }
        statusToast.textContent = msg;
        statusToast.style.display = 'block';
        statusToast.onclick = clickable ? () => { resetDualState(); showToast('双图选择已重置'); } : null;
    }

    function hideStatusToast() {
        if (statusToast) { statusToast.style.display = 'none'; statusToast.onclick = null; }
    }

    function showToast(msg) {
        const toast = document.createElement('div');
        toast.textContent = msg;
        Object.assign(toast.style, {
            position: 'fixed', bottom: '80px', left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(0,0,0,0.8)', color: 'white', padding: '10px 20px',
            borderRadius: '4px', zIndex: '9999999', fontSize: '14px', pointerEvents: 'none'
        });
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2000);
    }

    // ==================== 图片解析 ====================
    function parseImageSrc(src) {
        const match = src.match(/\/(\d+)_p(\d+)_.*\.(jpg|png|gif|jpeg)/i);
        if (match) return { illustId: match[1], pageIndex: parseInt(match[2], 10), extension: match[3].toLowerCase() };
        return null;
    }

    function buildCatUrl(illustId, pageIndex0, ext) {
        return `https://pixiv.cat/${illustId}-${pageIndex0 + 1}.${ext}`;
    }

    // ==================== 跳转逻辑 ====================
    function jumpSingle(catUrl) {
        const base = getCurrentScratchUrl();
        const url = `${base}/?mode=sheet&split=vertical&brush=${brushSheet}&maxpull=${maxPullSheet}&lang=auto&source=${encodeURIComponent(catUrl)}`;
        openOrCopy(url);
    }

    function jumpDual(coverUrl, baseUrl) {
        const base = getCurrentScratchUrl();
        const url = `${base}/?mode=separate&split=vertical&brush=${brushDual}&maxpull=${maxPullDual}&lang=auto` +
                    `&img1=${encodeURIComponent(coverUrl)}&img1Role=cover` +
                    `&img2=${encodeURIComponent(baseUrl)}&img2Role=base`;
        openOrCopy(url);
    }

    function jumpSingleWithSolidCover(baseUrl, naturalWidth, naturalHeight) {
        const solidUrl = getSolidColorDataUrl(solidColorName, naturalWidth, naturalHeight);
        const base = getCurrentScratchUrl();
        const url = `${base}/?mode=separate&split=vertical&brush=${brushSolid}&maxpull=${maxPullSolid}&lang=auto` +
                    `&img1=${encodeURIComponent(baseUrl)}&img1Role=cover` +
                    `&img2=${encodeURIComponent(solidUrl)}&img2Role=base`;
        openOrCopy(url);
    }

    // ==================== 右键菜单内容 ====================
    function showMenu(x, y, imgInfo, naturalWidth, naturalHeight) {
        if (!menu) createMenuDom();
        clearMenu();
        currentImgInfo = imgInfo;
        currentImgNaturalWidth = naturalWidth;
        currentImgNaturalHeight = naturalHeight;
        const { illustId, pageIndex, extension } = imgInfo;
        const catUrl = buildCatUrl(illustId, pageIndex, extension);
        const pageNum = pageIndex + 1;

        const title = document.createElement('div');
        title.textContent = '🎨 刮刮乐跳转';
        title.style.cssText = 'padding:6px 12px; color:#aaa; font-weight:bold; border-bottom:1px solid #444; margin-bottom:2px;';
        menu.appendChild(title);

        addItem(menu, '📷 单图拼贴模式（当前图）', () => {
            resetDualState();
            jumpSingle(catUrl);
        }, '使用当前图片作为标准拼贴图（需图片上半为涂层、下半为底图）');

        addItem(menu, `🖌️ 单图模式（纯色涂层 · ${solidColorName}）`, () => {
            resetDualState();
            jumpSingleWithSolidCover(catUrl, currentImgNaturalWidth, currentImgNaturalHeight);
        }, '纯色覆盖在上层，刮开后展示原图，保持原始尺寸比例');

        let dualText, dualHint, dualAction;
        if (dualState.baseUrl) {
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

        if (dualState.baseUrl) {
            const sep = document.createElement('div');
            sep.style.cssText = 'border-top:1px solid #444; margin:4px 0;';
            menu.appendChild(sep);
            addItem(menu, `🗑️ 重置双图选择（当前表图: P${dualState.basePage}）`, () => {
                resetDualState();
                showToast('双图选择已重置');
            }, '取消已选的表图');
        }

        menu.style.display = 'block';
        menu.style.left = Math.min(x, window.innerWidth - 300) + 'px';
        menu.style.top = Math.min(y, window.innerHeight - 220) + 'px';
    }

    // ==================== 快捷键判断 ====================
    function isArtworkImage(el) { return el.tagName === 'IMG' && el.src && el.src.includes('i.pximg.net'); }

    function checkModifiers(e) {
        const map = { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey };
        return triggerModifiers.every(m => map[m]);
    }

    // ==================== 事件绑定 ====================
    document.addEventListener('contextmenu', function(e) {
        const img = e.target;
        if (isArtworkImage(img) && checkModifiers(e)) {
            e.preventDefault();
            const info = parseImageSrc(img.src);
            if (info) {
                const naturalWidth = img.naturalWidth || img.width;
                const naturalHeight = img.naturalHeight || img.height;
                showMenu(e.clientX, e.clientY, info, naturalWidth, naturalHeight);
            }
        } else {
            hideMenu();
        }
    }, true);

    document.addEventListener('click', e => { if (menu && !menu.contains(e.target)) hideMenu(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') hideMenu(); });
    window.addEventListener('scroll', hideMenu);
    window.addEventListener('resize', hideMenu);

    // ==================== 管理界面：载入网址（支持本地路径）====================
    function showSiteManager() {
        const modal = document.createElement('div');
        Object.assign(modal.style, {
            position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
            background: 'rgba(0,0,0,0.7)', display: 'flex', justifyContent: 'center',
            alignItems: 'center', zIndex: '99999999'
        });
        const dialog = document.createElement('div');
        Object.assign(dialog.style, {
            background: '#2a2a2a', border: '1px solid #555', borderRadius: '8px',
            padding: '20px', minWidth: '500px', maxWidth: '700px', maxHeight: '80vh',
            overflowY: 'auto', color: '#ddd', fontSize: '14px', boxShadow: '0 4px 20px rgba(0,0,0,0.8)'
        });

        const title = document.createElement('h2');
        title.textContent = '🌐 自定义刮刮乐网址管理';
        title.style.cssText = 'margin:0 0 15px; color:#fff;';
        dialog.appendChild(title);

        const hint = document.createElement('div');
        hint.style.cssText = 'background:#444; padding:8px 12px; border-radius:4px; margin-bottom:15px; font-size:12px; color:#aaa;';
        hint.innerHTML = `<b>说明：</b>支持 <code>https://</code>、<code>http://</code> 或 <code>file:///</code> 开头的完整网址。<br>
                          列表按顺序使用，第一个<b>启用</b>的网址会被用于跳转。<br>
                          <b>注意：</b>file:// 本地路径只能复制链接，无法自动打开新标签页。`;
        dialog.appendChild(hint);

        const listContainer = document.createElement('div');
        listContainer.style.cssText = 'margin-bottom:15px;';

        function renderList() {
            listContainer.innerHTML = '';
            customSites.forEach((site, idx) => {
                const item = document.createElement('div');
                item.style.cssText = 'display:flex; align-items:center; margin-bottom:6px; background:#333; padding:6px 10px; border-radius:4px;';
                const check = document.createElement('input');
                check.type = 'checkbox'; check.checked = site.enabled; check.style.marginRight = '10px';
                check.addEventListener('change', () => {
                    customSites[idx].enabled = check.checked;
                    GM_setValue('customSites', customSites);
                });
                item.appendChild(check);
                const urlText = document.createElement('span');
                urlText.textContent = site.url; urlText.style.cssText = 'flex:1; word-break:break-all;';
                item.appendChild(urlText);
                const delBtn = document.createElement('button');
                delBtn.textContent = '删除';
                delBtn.style.cssText = 'background:#a33; border:none; color:white; padding:4px 10px; border-radius:3px; cursor:pointer; margin-left:10px;';
                delBtn.addEventListener('click', () => {
                    if (confirm('确定删除？')) {
                        customSites.splice(idx, 1);
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

        const addArea = document.createElement('div');
        addArea.style.cssText = 'display:flex; gap:10px; margin-bottom:15px;';
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'https://... 或 file:///C:/...';
        input.style.cssText = 'flex:1; padding:6px 10px; border-radius:4px; border:1px solid #555; background:#222; color:#ddd;';
        const addBtn = document.createElement('button');
        addBtn.textContent = '添加';
        addBtn.style.cssText = 'background:#2a7; border:none; color:white; padding:6px 16px; border-radius:4px; cursor:pointer;';
        addBtn.addEventListener('click', () => {
            const url = input.value.trim();
            if (!url) return alert('请输入网址');
            if (!url.startsWith('https://') && !url.startsWith('http://') && !url.startsWith('file://')) {
                return alert('网址必须以 https://、http:// 或 file:// 开头');
            }
            if (customSites.some(s => s.url === url)) return alert('该网址已存在');
            customSites.push({ url, enabled: true });
            GM_setValue('customSites', customSites);
            input.value = '';
            renderList();
        });
        addArea.appendChild(input); addArea.appendChild(addBtn);
        dialog.appendChild(addArea);

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '关闭';
        closeBtn.style.cssText = 'background:#555; border:none; color:white; padding:8px 20px; border-radius:4px; cursor:pointer; float:right;';
        closeBtn.addEventListener('click', () => document.body.removeChild(modal));
        dialog.appendChild(closeBtn);
        modal.appendChild(dialog);
        document.body.appendChild(modal);
        modal.addEventListener('click', e => { if (e.target === modal) document.body.removeChild(modal); });
    }

    // ==================== 使用说明书 ====================
    function showInstructions() {
        const modal = document.createElement('div');
        Object.assign(modal.style, {
            position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
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
        title.style.cssText = 'margin:0 0 15px; color:#fff;';
        dialog.appendChild(title);

        const content = document.createElement('div');
        content.innerHTML = `
            <h3>🎨 刮刮乐服务说明</h3>
            <p>默认使用 <a href="https://mirumo-scratch-card.pages.dev/" target="_blank" style="color:#6af;">mirumo-scratch-card.pages.dev</a> 提供的刮刮乐功能。</p>
            <h4>✅ 能做什么：</h4>
            <ul>
                <li>将任意 Pixiv 图片制作成刮刮乐效果。</li>
                <li>支持单图+纯色涂层（保持原图比例，刮开涂层展示作品）。</li>
                <li>每种模式拥有独立的画笔大小和擦除力度设置。</li>
                <li>纯色涂层颜色可独立调整（10种可选）。</li>
                <li>支持本地刮刮乐文件（file://），自动复制链接到剪贴板。</li>
            </ul>
            <h4>⚠️ 已知问题：部分图片加载失败</h4>
            <p>使用反代链接（pixiv.cat 等）时，某些 JPG 图片可能因编码差异导致 Canvas 无法解析。暂无彻底解决方法。建议使用“单图纯色涂层”模式或下载后本地上传。</p>
            <h4>⚙️ 如何正确使用：</h4>
            <ol>
                <li>在 Pixiv 作品页上，按住 <strong>Ctrl+Alt</strong>（默认）再右键点击任意作品图片。</li>
                <li>选择“单图拼贴模式”、“单图纯色涂层”或“双图模式”。</li>
                <li>在 Tampermonkey 菜单中分别调整各模式的参数。</li>
                <li>通过“载入网址”可添加自己的刮刮乐网址或本地文件。</li>
            </ol>
            <p style="color:#aaa; font-size:12px;">本地文件路径将自动复制链接，不会直接跳转。</p>
        `;
        dialog.appendChild(content);

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '关闭';
        closeBtn.style.cssText = 'background:#555; border:none; color:white; padding:8px 20px; border-radius:4px; cursor:pointer; float:right; margin-top:10px;';
        closeBtn.addEventListener('click', () => document.body.removeChild(modal));
        dialog.appendChild(closeBtn);
        modal.appendChild(dialog);
        document.body.appendChild(modal);
        modal.addEventListener('click', e => { if (e.target === modal) document.body.removeChild(modal); });
    }

    // ==================== Tampermonkey 菜单 ====================
    function registerConfigMenus() {
        GM_registerMenuCommand(`📷 单图拼贴 - 画笔大小 (${brushSheet})`, () => {
            const val = prompt('单图拼贴模式 - 画笔相对比例 (1-40，默认8)', brushSheet);
            if (val !== null) {
                const n = parseFloat(val);
                if (n > 0 && n <= 40) {
                    brushSheet = n;
                    GM_setValue('brushSheet', n);
                    alert('单图拼贴模式画笔大小已更新');
                }
            }
        });
        GM_registerMenuCommand(`📷 单图拼贴 - 擦除力度 (${maxPullSheet})`, () => {
            const val = prompt('单图拼贴模式 - 拉动行程上限 px (100-1000，默认300)', maxPullSheet);
            if (val !== null) {
                const n = parseInt(val, 10);
                if (n >= 100 && n <= 1000) {
                    maxPullSheet = n;
                    GM_setValue('maxPullSheet', n);
                    alert('单图拼贴模式擦除力度已更新');
                }
            }
        });

        GM_registerMenuCommand(`🖌️ 单图纯色 - 画笔大小 (${brushSolid})`, () => {
            const val = prompt('单图纯色模式 - 画笔相对比例 (1-40，默认8)', brushSolid);
            if (val !== null) {
                const n = parseFloat(val);
                if (n > 0 && n <= 40) {
                    brushSolid = n;
                    GM_setValue('brushSolid', n);
                    alert('单图纯色模式画笔大小已更新');
                }
            }
        });
        GM_registerMenuCommand(`🖌️ 单图纯色 - 擦除力度 (${maxPullSolid})`, () => {
            const val = prompt('单图纯色模式 - 拉动行程上限 px (100-1000，默认300)', maxPullSolid);
            if (val !== null) {
                const n = parseInt(val, 10);
                if (n >= 100 && n <= 1000) {
                    maxPullSolid = n;
                    GM_setValue('maxPullSolid', n);
                    alert('单图纯色模式擦除力度已更新');
                }
            }
        });
        GM_registerMenuCommand(`🖌️ 单图纯色 - 涂层颜色 (当前: ${solidColorName})`, () => {
            const colorList = Object.keys(SOLID_COLOR_MAP);
            const message = '请选择涂层颜色（输入名称或序号）：\n' +
                            colorList.map((c, i) => `${i+1}. ${c}`).join('\n');
            const choice = prompt(message, solidColorName);
            if (choice !== null) {
                const trimmed = choice.trim();
                let newColor = null;
                if (SOLID_COLOR_MAP[trimmed]) {
                    newColor = trimmed;
                } else {
                    const idx = parseInt(trimmed, 10);
                    if (idx >= 1 && idx <= colorList.length) {
                        newColor = colorList[idx - 1];
                    }
                }
                if (newColor) {
                    solidColorName = newColor;
                    GM_setValue('solidColor', newColor);
                    alert(`涂层颜色已设置为：${newColor}`);
                } else {
                    alert('输入无效，保持原颜色');
                }
            }
        });

        GM_registerMenuCommand(`🖼️ 双图模式 - 画笔大小 (${brushDual})`, () => {
            const val = prompt('双图模式 - 画笔相对比例 (1-40，默认8)', brushDual);
            if (val !== null) {
                const n = parseFloat(val);
                if (n > 0 && n <= 40) {
                    brushDual = n;
                    GM_setValue('brushDual', n);
                    alert('双图模式画笔大小已更新');
                }
            }
        });
        GM_registerMenuCommand(`🖼️ 双图模式 - 擦除力度 (${maxPullDual})`, () => {
            const val = prompt('双图模式 - 拉动行程上限 px (100-1000，默认300)', maxPullDual);
            if (val !== null) {
                const n = parseInt(val, 10);
                if (n >= 100 && n <= 1000) {
                    maxPullDual = n;
                    GM_setValue('maxPullDual', n);
                    alert('双图模式擦除力度已更新');
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

        GM_registerMenuCommand('🌐 载入网址', () => showSiteManager());
        GM_registerMenuCommand('📖 使用说明书', () => showInstructions());
    }

    registerConfigMenus();
    resetDualState();

})();
