/**
 * 「暂无图片」占位图。
 * 物料列表 / 详情在拿不到缩略图（未上传、外链失效、立创未收录）时统一展示，
 * 避免出现空白块或纯图标占位。
 *
 * 用内联 SVG data URL：不引入额外资源文件，也不产生额外网络请求，
 * 且 imagePublicUrl 对 data: 协议会原样透传（万一被存进 image_path 也能正常显示）。
 */
export const NO_IMAGE_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">
  <rect width="120" height="120" fill="#EEF1F6"/>
  <rect x="28" y="26" width="64" height="48" rx="6" fill="none" stroke="#BFC7D4" stroke-width="3"/>
  <circle cx="45" cy="42" r="5" fill="#BFC7D4"/>
  <path d="M31 68 L49 51 L61 63 L70 54 L80 68 Z" fill="#BFC7D4"/>
  <text x="60" y="96" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" fill="#98A2B3">暂无图片</text>
</svg>`,
  // encodeURIComponent 不转义单引号；URL 会被放进 this.src='...'，残留的 ' 会截断字符串
).replace(/'/g, '%27')}`

/**
 * 图片加载失败时回退到占位图的内联 onerror 表达式。
 * 用法：<img :src="url || NO_IMAGE_URL" :onerror="NO_IMAGE_ONERROR" />
 *
 * 不用 v-if/v-else 是因为那样只能判断「有没有 URL」，判断不了「URL 加载失败」
 * （立创外链失效、图片被删等），此时会显示破图。
 * 先置空 onerror 再改 src，避免占位图自身加载失败时循环触发。
 */
export const NO_IMAGE_ONERROR = `this.onerror=null;this.src='${NO_IMAGE_URL}'`
