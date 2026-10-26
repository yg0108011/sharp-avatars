# 高清头像增强 · Sharp Avatars

一个 SillyTavern 第三方扩展，解决**角色头像 / 用户头像上传后显示发虚、模糊**的问题。
纯浏览器前端实现，不需要修改服务端配置、不需要重启酒馆，安装后即时生效。

---

## 一、头像为什么会模糊？

对照 SillyTavern 官方源码核实，模糊来自两层：

1. **服务端默认生成低清缩略图**
   `config.yaml` 中头像缩略图默认尺寸只有 **96×144**，格式为 JPEG（质量 95）。
   前端角色列表、聊天头像、角色编辑面板预览、放大弹窗、persona 列表等位置，
   加载的都是这个 `/thumbnail?type=avatar&file=xxx` 小图，界面上被放大 2~3 倍显示，于是发虚。

2. **上传时可能被二次压缩**
   默认情况下导入 / 上传头像会被服务端裁剪、缩放到 512×768；原图细节在入库时就已经丢失。

本扩展针对第 1 层：**在浏览器端把缩略图地址替换成服务端直接提供的原图地址**，
原图若 404 会自动回退缩略图，不会出现裂图。

| 显示位置 | 扩展是否覆盖 |
| --- | --- |
| 角色选择列表头像 | ✅ |
| 聊天消息角色头像 / 用户头像 | ✅ |
| 角色编辑面板大预览图 | ✅ |
| 点击头像弹出的放大弹窗 | ✅ |
| persona（用户头像）选择列表 | ✅（可独立开关） |
| 聊天背景选择缩略图 | ⚙️ 可选，默认关闭（省流量） |
| 表情立绘 / sprite / 角色画廊插图 | ❌ 不在本扩展范围 |

---

## 二、安装

### 方式 A：本地目录安装（手机端 / 单用户推荐）

把整个 `sharp-avatars` 文件夹放到酒馆的扩展目录：

- **仅当前用户**：`data/default-user/extensions/sharp-avatars/`
  （多用户账号则是 `data/<你的用户名>/extensions/sharp-avatars/`）
- **所有用户**：`public/scripts/extensions/third-party/sharp-avatars/`

> 手机端部署时，用文件管理器进入酒馆数据目录（例如
> `/storage/BA73-022B/SillyTavern/data/default-user/extensions/`），
> 把本文件夹上传到该目录下即可。

### 方式 B：Git 在线安装

1. 本扩展已托管在 GitHub：<https://github.com/yg0108011/sharp-avatars>
2. 酒馆左侧菜单 → **扩展（Extensions）** → **Install extension**；
3. 粘贴仓库 Git URL：`https://github.com/yg0108011/sharp-avatars.git`，确认安装；
4. 在扩展管理列表里找到「高清头像增强 · Sharp Avatars」并启用，按提示刷新页面。

### 确认生效

刷新酒馆页面后打开 **扩展设置**，能看到「高清头像增强 · Sharp Avatars」面板即安装成功。
默认开关全部开启（背景图替换除外），无需额外配置。

---

## 三、设置项说明

打开 **扩展设置 → 高清头像增强 · Sharp Avatars**：

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| 原图直出（总开关） | 开 | 角色头像绕过低清缩略图，直接显示原图 |
| 同时替换用户（persona）头像 | 开 | 自己的头像也使用原图 |
| 同时替换背景图缩略图 | 关 | 背景原图较大，默认不替换，避免耗流量 / 拖慢加载 |
| 轻度锐化 | 关 | 仅做对比度 1.04、饱和度 1.035 的微调，不做破坏性滤镜 |
| 调试日志 | 关 | 在浏览器控制台输出替换记录，排查问题时打开 |

「立即刷新头像」按钮：手动触发一次全页面扫描替换。

---

## 四、工作原理（供参考）

服务端缩略图接口与原图静态路由的对应关系（对照官方源码 `src/users.js`、`src/endpoints/thumbnails.js`）：

| 类型 | 缩略图地址 | 替换后的原图地址 |
| --- | --- | --- |
| `avatar` 角色 | `/thumbnail?type=avatar&file=xxx.png` | `/characters/xxx.png` |
| `persona` 用户 | `/thumbnail?type=persona&file=xxx.png` | `/User%20Avatars/xxx.png` |
| `bg` 背景 | `/thumbnail?type=bg&file=xxx.jpg` | `/backgrounds/xxx.jpg` |

扩展通过 `MutationObserver` 持续监听页面中新增与变更的 `<img>`，
命中缩略图地址即替换；同时在切换聊天、切换角色、切换 persona、消息渲染完成等事件后主动重扫。
已持久化到旧聊天记录里的 `force_avatar`（缩略图地址）同样会被替换。

---

## 五、附录 A：服务端根治方案（config.yaml）

> 本扩展已经能解决前端显示模糊。下面方案用于**彻底根治服务端**：
> 让未装扩展的设备、其他客户端、角色导出场景也保持高清，需要重启酒馆生效。

### 1. 调整缩略图配置

编辑酒馆根目录的 `config.yaml`（不要直接修改 `default/config.yaml` 模板），找到 `thumbnails` 段，改为：

```yaml
# THUMBNAILING CONFIGURATION
thumbnails:
  # 启用缩略图生成
  enabled: true

  # 缩略图格式：
  #   jpg : 体积小，有轻微压缩痕迹，不支持透明
  #   png : 保留透明通道、无压缩感，体积约大 100%
  format: png

  # JPEG 缩略图质量 0-100（format 为 png 时此项不生效）
  quality: 100

  # 各类型缩略图最大尺寸 [宽, 高]
  dimensions:
    bg: [240, 135]
    avatar: [864, 1280]
    persona: [864, 1280]
```

> 部分手机打包环境（旧版 APK / 特定数据目录）如果发现根目录 `config.yaml` 改了不生效，
> 再检查 `SillyTavern/default/config.yaml` 中同名段落，做同样修改。

### 2. 清理旧缩略图缓存（必须执行）

旧的低清缩略图不会自动更新，需要手动删除缓存目录：

- 新版酒馆：`data/<用户目录>/thumbnails/`（可整个删除，会按需自动重建）
- 旧版酒馆：`public/thumbnails/` 或 `data/default-user/thumbnails/`

对应子目录 `avatar/`、`persona/`、`bg/` 内的文件全部清空即可。

### 3. 重启酒馆

保存配置并重启服务，新配置才会生效。

---

## 六、附录 B：上传时不要压缩头像

酒馆默认会把上传 / 导入的头像裁剪并缩放到 512×768。要保留原图细节：

1. 打开 **设置 → 高级用户设置（Advanced User Settings）**；
2. 勾选 **Never resize avatars（永不缩放头像）**；
3. **已经上传过的头像需要重新上传**一次，配置只对之后的上传生效。

---

## 七、故障排查

| 现象 | 排查思路 |
| --- | --- |
| 开了扩展头像还是模糊 | 打开「调试日志」刷新页面，看控制台是否有替换记录；若出现「原图 404，回退缩略图」，检查角色文件名是否含特殊字符，或对照附录 A 重建缩略图 |
| 新上传的头像立刻就糊 | 属于上传阶段被压缩：先勾选「Never resize avatars」，再重新上传头像 |
| 切换角色时头像短暂模糊后变清晰 | 属正常，观察者有 120ms 节流，事件触发后会立即替换 |
| 背景图还是模糊 | 在面板里打开「同时替换背景图缩略图」开关 |
| 表情立绘 / 小插图模糊 | 不在本扩展覆盖范围，这些走独立的 sprite / assets 路由 |
| 面板里找不到本扩展 | 确认文件夹位于 `extensions/sharp-avatars/`，且 `manifest.json` 直接放在该层；刷新扩展管理页面 |

---

## 八、文件结构

```
sharp-avatars/
├── manifest.json      # 扩展清单（ST 加载入口）
├── index.js           # 核心逻辑：URL 替换、观察者、设置面板
├── style.css          # 锐化滤镜与面板样式
├── settings.html       # 扩展设置面板模板
├── i18n/
│   ├── zh-cn.json     # 简体中文
│   └── en.json        # English
└── README.md          # 本说明
```

## 许可证

AGPLv3（与 SillyTavern 扩展生态保持一致）。
