/**
 * 高清头像增强 · Sharp Avatars
 * ----------------------------------------------------------------------------
 * 解决 SillyTavern 角色 / persona 头像上传后显示模糊的问题。
 *
 * 原理（对照官方源码核实）：
 *  - 服务端默认把头像压成 96×144 的 JPEG 缩略图，前端所有头像位置
 *    （角色列表、聊天头像、编辑面板预览、放大弹窗、persona 列表等）
 *    实际加载的都是 `/thumbnail?type=avatar|persona|bg&file=xxx` 这个低清文件，
 *    在界面上被放大显示，于是发虚模糊。
 *  - 本扩展在浏览器端把这些缩略图地址替换为服务端直接提供的原图静态路由：
 *      avatar  -> /characters/<file>
 *      persona -> /User%20Avatars/<file>
 *      bg      -> /backgrounds/<file>
 *  - 原图若 404 会自动回退到原缩略图，不会出现裂图。
 *
 * 注意：本扩展只在浏览器前端生效，不修改服务端 config.yaml。
 * 若上传时图片本身已被压缩、或需要服务端根治，请参考 README.md 附录方案。
 */

const MODULE_NAME = 'sharpAvatars';
const MODULE_TITLE = '高清头像增强 · Sharp Avatars';

/** 默认设置 */
const defaultSettings = {
    enabled: true,            // 总开关：原图直出（角色头像）
    replacePersona: true,     // 用户 persona 头像同样换原图
    replaceBackground: false, // 背景缩略图换原图（默认关闭，避免大图耗流量）
    sharpen: false,           // 轻度对比度 / 饱和度微调
    debug: false,             // 控制台调试日志
};

let context = {};
let settings = structuredClone(defaultSettings);
let observer = null;
let scanTimer = null;
let settingsBound = false;

/** 服务端原图静态路由（对照 src/users.js 的 userDataRouter） */
const TYPE_ROUTE = {
    avatar: '/characters/',
    persona: '/User%20Avatars/',
    bg: '/backgrounds/',
};

function debugLog(...args) {
    if (settings.debug) console.log(`[${MODULE_TITLE}]`, ...args);
}

// ---------------------------------------------------------------------------
// URL 解析与替换
// ---------------------------------------------------------------------------

/**
 * 解析缩略图地址 `/thumbnail?type=avatar&file=xxx.png[&t=时间戳]`
 * @param {string} src
 * @returns {{type: keyof TYPE_ROUTE, file: string} | null}
 */
function parseThumbnailSrc(src) {
    if (typeof src !== 'string' || !src) return null;
    if (src.startsWith('data:') || src.startsWith('blob:')) return null;

    let pathname;
    let search;
    try {
        const u = new URL(src, window.location.origin);
        pathname = u.pathname;
        search = u.search;
    } catch {
        return null;
    }

    // 兼容 `/thumbnail`、`/thumbnail/` 结尾
    if (!/\/thumbnail\/?$/.test(pathname)) return null;

    const params = new URLSearchParams(search);
    const type = params.get('type');
    const file = params.get('file');
    if (!Object.hasOwn(TYPE_ROUTE, type) || !file) return null;

    return { type, file };
}

/** 由 type 与文件名拼出原图静态地址 */
function originalUrl(type, file) {
    return TYPE_ROUTE[type] + encodeURIComponent(file);
}

/** 当前类型是否允许替换（受总开关与分项开关控制） */
function typeAllowed(type) {
    if (!settings.enabled) return false;
    if (type === 'persona') return settings.replacePersona;
    if (type === 'bg') return settings.replaceBackground;
    return true;
}

/** 回退到原始缩略图地址 */
function restoreThumbnail(img) {
    const fallback = img.dataset.sharpFallback;
    if (fallback && img.getAttribute('src') !== fallback) {
        img.setAttribute('src', fallback);
    }
    delete img.dataset.sharpTarget;
}

/** 404 兜底：原图加载失败时回退缩略图，避免裂图 */
function onImageError(event) {
    const img = event.currentTarget;
    const fallback = img.dataset.sharpFallback;
    if (!fallback) return;
    debugLog('原图 404，回退缩略图:', fallback);
    img.removeEventListener('error', onImageError);
    img.src = fallback;
    delete img.dataset.sharpTarget;
}

/** 处理单个 <img> */
function processImage(img) {
    if (!(img instanceof HTMLImageElement)) return;
    const src = img.getAttribute('src');
    if (!src || src.startsWith('data:') || src.startsWith('blob:')) return;

    const parsed = parseThumbnailSrc(src);

    // 未命中缩略图地址，或当前开关关闭：若此前处理过则恢复缩略图
    if (!parsed || !typeAllowed(parsed.type)) {
        if (img.dataset.sharpFallback) restoreThumbnail(img);
        return;
    }

    const target = originalUrl(parsed.type, parsed.file);

    // 已经是目标原图，跳过（防止 observer 循环触发重复请求）
    if (img.dataset.sharpTarget === target) return;

    // 首次处理：保存原缩略图地址作为 404 兜底
    if (!img.dataset.sharpFallback) img.dataset.sharpFallback = src;
    img.dataset.sharpTarget = target;

    img.addEventListener('error', onImageError, { once: true });
    img.src = target;
    debugLog('替换缩略图 -> 原图', parsed.type, parsed.file, '=>', target);
}

/** 扫描指定作用域内所有疑似缩略图 <img> */
function scanAll(root = document) {
    root.querySelectorAll('img[src*="thumbnail"]').forEach(processImage);
}

// ---------------------------------------------------------------------------
// MutationObserver：覆盖动态渲染的角色列表、聊天消息、弹窗等
// ---------------------------------------------------------------------------

function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
        scanTimer = null;
        scanAll();
    }, 120);
}

function startObserver() {
    if (observer) return;
    observer = new MutationObserver(() => scheduleScan());
    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src'],
    });
}

function stopObserver() {
    if (observer) observer.disconnect();
    observer = null;
}

// ---------------------------------------------------------------------------
// 设置读写
// ---------------------------------------------------------------------------

function loadSettings() {
    if (!context.extensionSettings) context.extensionSettings = {};
    const extSettings = context.extensionSettings;
    const lodash = SillyTavern?.libs?.lodash;
    if (lodash) {
        settings = lodash.merge(structuredClone(defaultSettings), extSettings[MODULE_NAME] ?? {});
    } else {
        settings = Object.assign({}, structuredClone(defaultSettings), extSettings[MODULE_NAME] ?? {});
    }
    extSettings[MODULE_NAME] = settings;
    applyVisualState();
}

function saveSettings() {
    // 写回最新设置并触发 ST 防抖保存
    if (context.extensionSettings) context.extensionSettings[MODULE_NAME] = settings;
    if (typeof context.saveSettingsDebounced === 'function') context.saveSettingsDebounced();
}

function applyVisualState() {
    document.body.classList.toggle('sharp-sharpen-on', !!settings.sharpen);
}

// ---------------------------------------------------------------------------
// 设置面板
// ---------------------------------------------------------------------------

async function renderSettingsPanel() {
    if (settingsBound) return;
    try {
        const html = await context.renderExtensionTemplateAsync(
            'third-party/sharp-avatars',
            'settings',
            settings,
        );
        $('#extensions_settings2').append(html);
        bindSettings();
        settingsBound = true;
    } catch (error) {
        console.error(`[${MODULE_TITLE}] 设置面板渲染失败:`, error);
    }
}

function bindSettings() {
    const $enabled = $('#sharp_enabled');
    const $persona = $('#sharp_persona');
    const $bg = $('#sharp_bg');
    const $sharpen = $('#sharp_sharpen');
    const $debug = $('#sharp_debug');

    $enabled.prop('checked', settings.enabled);
    $persona.prop('checked', settings.replacePersona);
    $bg.prop('checked', settings.replaceBackground);
    $sharpen.prop('checked', settings.sharpen);
    $debug.prop('checked', settings.debug);

    $enabled.on('change', () => { settings.enabled = $enabled.prop('checked'); onSettingsChanged(); });
    $persona.on('change', () => { settings.replacePersona = $persona.prop('checked'); onSettingsChanged(); });
    $bg.on('change', () => { settings.replaceBackground = $bg.prop('checked'); onSettingsChanged(); });
    $sharpen.on('change', () => { settings.sharpen = $sharpen.prop('checked'); onSettingsChanged(); });
    $debug.on('change', () => { settings.debug = $debug.prop('checked'); onSettingsChanged(); });

    $('#sharp_refresh').on('click', () => {
        scanAll();
        if (typeof toastr !== 'undefined') {
            const message = typeof context.t === 'function' ? context.t('头像已刷新') : '头像已刷新';
            toastr.success(message, MODULE_TITLE);
        }
    });
}

function onSettingsChanged() {
    applyVisualState();
    saveSettings();
    // 开关切换后延迟重扫：关闭的类型恢复缩略图，开启的类型换原图
    setTimeout(scanAll, 60);
}

// ---------------------------------------------------------------------------
// 事件挂载
// ---------------------------------------------------------------------------

function bindEvents() {
    const es = context.eventSource;
    const et = context.eventTypes ?? context.event_types ?? {};
    if (!es) return;

    // 切换角色 / 聊天 / persona / 渲染消息后主动重扫（observer 已兜底，这里加速刷新）
    const refreshEvents = [
        'CHAT_CHANGED', 'CHAT_LOADED',
        'CHARACTER_EDITOR_OPENED', 'CHARACTER_PAGE_LOADED', 'CHARACTER_EDITED',
        'PERSONA_CHANGED', 'PERSONA_UPDATED', 'PERSONA_CREATED',
        'CHARACTER_MESSAGE_RENDERED', 'USER_MESSAGE_RENDERED', 'MORE_MESSAGES_LOADED',
        'GROUP_UPDATED', 'CHARACTER_DELETED', 'CHARACTER_RENAMED',
    ];

    for (const name of refreshEvents) {
        const ev = et[name];
        if (!ev) continue;
        es.on(ev, () => scheduleScan());
    }

    // 页面就绪后启动 observer 并全量扫描
    if (et.APP_READY) {
        es.on(et.APP_READY, () => { startObserver(); scanAll(); });
    }

    // 设置面板在扩展设置加载完成后挂载
    if (et.EXTENSION_SETTINGS_LOADED) {
        es.on(et.EXTENSION_SETTINGS_LOADED, () => renderSettingsPanel());
    }
}

// ---------------------------------------------------------------------------
// 初始化与生命周期钩子
// ---------------------------------------------------------------------------

let initRetries = 0;

function init() {
    try {
        context = (typeof SillyTavern !== 'undefined' && typeof SillyTavern.getContext === 'function')
            ? (SillyTavern.getContext() ?? {})
            : {};
        loadSettings();
        bindEvents();
        renderSettingsPanel();
        // 兜底：APP_READY 之前页面上已经存在的头像
        startObserver();
        scanAll();
        console.log(`[${MODULE_TITLE}] 已加载 v1.0.0`);
    } catch (error) {
        console.error(`[${MODULE_TITLE}] 初始化失败:`, error);
        // 全局对象尚未就绪时，延迟重试（最多 5 次）
        if (initRetries < 5) {
            initRetries += 1;
            setTimeout(init, 500);
        }
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

/** manifest.hooks.enable */
export function onEnable() {
    startObserver();
    scanAll();
}

/** manifest.hooks.disable */
export function onDisable() {
    stopObserver();
}
