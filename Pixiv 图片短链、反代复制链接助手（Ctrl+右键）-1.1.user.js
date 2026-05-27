// ==UserScript==
// @name         Pixiv 图片短链、反代复制链接助手（Ctrl+右键）
// @namespace    https://www.pixiv.net/
// @version      1.1
// @description  在 Pixiv 作品图片上按住 Ctrl 右键，选择复制不同短域名的图片链接
// @author       smX456464
// @homepage     https://github.com/smX456464
// @supportURL   https://github.com/smX456464
// @license MIT
// @match        https://www.pixiv.net/*
// @grant        GM_setClipboard
// @grant        GM_addStyle
// @antifeature  adult-content  此脚本在包含成人内容的网站上运行 (Pixiv)
// @downloadURL https://update.greasyfork.org/scripts/580026/Pixiv%20%E5%9B%BE%E7%89%87%E7%9F%AD%E9%93%BE%E3%80%81%E5%8F%8D%E4%BB%A3%E5%A4%8D%E5%88%B6%E9%93%BE%E6%8E%A5%E5%8A%A9%E6%89%8B%EF%BC%88Ctrl%2B%E5%8F%B3%E9%94%AE%EF%BC%89.user.js
// @updateURL https://update.greasyfork.org/scripts/580026/Pixiv%20%E5%9B%BE%E7%89%87%E7%9F%AD%E9%93%BE%E3%80%81%E5%8F%8D%E4%BB%A3%E5%A4%8D%E5%88%B6%E9%93%BE%E6%8E%A5%E5%8A%A9%E6%89%8B%EF%BC%88Ctrl%2B%E5%8F%B3%E9%94%AE%EF%BC%89.meta.js
// ==/UserScript==

(function() {
    'use strict';

    const domains = ['pixiv.cat', 'pixiv.re', 'pixiv.nl'];
    let menu = null;
    let currentImageInfo = null;

    function createMenu() {
        menu = document.createElement('div');
        menu.id = 'pixiv-shortlink-menu';
        menu.style.cssText = `
            position: fixed;
            background: #2a2a2a;
            border: 1px solid #555;
            border-radius: 6px;
            padding: 4px 0;
            z-index: 999999;
            display: none;
            min-width: 240px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.5);
            color: #ddd;
            font-size: 14px;
            font-family: 'Segoe UI', Arial, sans-serif;
        `;

        const title = document.createElement('div');
        title.textContent = '复制短链接';
        title.style.cssText = 'padding: 6px 12px; color: #aaa; font-weight: bold; border-bottom: 1px solid #444; margin-bottom: 2px; cursor: default;';
        menu.appendChild(title);

        domains.forEach(domain => {
            const item = document.createElement('div');
            item.textContent = domain;
            item.style.cssText = 'padding: 8px 12px; cursor: pointer; transition: background 0.15s;';
            item.addEventListener('click', () => {
                if (currentImageInfo) {
                    const shortUrl = buildShortUrl(currentImageInfo, domain);
                    copyToClipboard(shortUrl);
                    hideMenu();
                }
            });
            item.addEventListener('mouseenter', () => { item.style.background = '#3a6ea5'; });
            item.addEventListener('mouseleave', () => { item.style.background = ''; });
            menu.appendChild(item);
        });

        document.body.appendChild(menu);
    }

    function parseImageSrc(src) {
        const match = src.match(/\/(\d+)_p(\d+)_.*\.(jpg|png|gif|jpeg)/i);
        if (match) {
            return {
                illustId: match[1],
                pageIndex: parseInt(match[2], 10),
                extension: match[3].toLowerCase()
            };
        }
        return null;
    }

    function buildShortUrl(info, domain) {
        const pageNumber = info.pageIndex + 1;
        return `https://${domain}/${info.illustId}-${pageNumber}.${info.extension}`;
    }

    function copyToClipboard(text) {
        try {
            GM_setClipboard(text, 'text');
            showToast('已复制: ' + text);
        } catch (e) {
            navigator.clipboard.writeText(text).then(() => {
                showToast('已复制: ' + text);
            }).catch(() => {
                alert('复制失败，请手动复制:\n' + text);
            });
        }
    }

    function showToast(message) {
        const toast = document.createElement('div');
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            bottom: 30px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0,0,0,0.8);
            color: white;
            padding: 10px 20px;
            border-radius: 4px;
            z-index: 9999999;
            font-size: 14px;
            pointer-events: none;
        `;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2000);
    }

    function showMenu(x, y) {
        if (!menu) createMenu();
        menu.style.display = 'block';
        menu.style.left = x + 'px';
        menu.style.top = y + 'px';
    }

    function hideMenu() {
        if (menu) menu.style.display = 'none';
        currentImageInfo = null;
    }

    function isArtworkImage(element) {
        return element.tagName === 'IMG' &&
               element.src &&
               element.src.includes('i.pximg.net');
    }

    document.addEventListener('contextmenu', function(e) {
        const img = e.target;
        if (isArtworkImage(img) && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            const info = parseImageSrc(img.src);
            if (info) {
                currentImageInfo = info;
                showMenu(e.clientX, e.clientY);
            }
        } else {
            hideMenu();
        }
    }, true);

    document.addEventListener('click', function(e) {
        if (menu && !menu.contains(e.target)) hideMenu();
    });

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') hideMenu();
    });

    window.addEventListener('scroll', hideMenu);
    window.addEventListener('resize', hideMenu);

})();