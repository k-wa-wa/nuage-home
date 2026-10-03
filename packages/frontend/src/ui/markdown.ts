import DOMPurify from "dompurify";
import { marked } from "marked";

/**
 * marked のリンクレンダラーで、外部リンクに target="_blank" と rel="noopener noreferrer" を自動付与する。
 */
marked.use({
  renderer: {
    link({ href, title, text }) {
      const titleAttr = title ? ` title="${title}"` : "";
      return `<a href="${href}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
    },
  },
});

function initPurify() {
  if (typeof window !== "undefined") {
    const instance = typeof DOMPurify === "function" ? DOMPurify(window) : DOMPurify;
    if (instance && typeof instance.addHook === "function") {
      instance.addHook("afterSanitizeAttributes", (node) => {
        if (node.tagName === "A") {
          node.setAttribute("target", "_blank");
          node.setAttribute("rel", "noopener noreferrer");
        }
      });
      return instance;
    }
  }
  return null;
}

const purify = initPurify();

/**
 * Markdown 文字列を安全な HTML に変換する。
 * marked でパースした後に DOMPurify でサニタイズを行う。
 */
export function renderMarkdown(markdown: string): string {
  if (!markdown) return "";
  const rawHtml = marked.parse(markdown, {
    gfm: true,
    breaks: true,
    async: false,
  }) as string;

  if (purify) {
    return purify.sanitize(rawHtml, {
      ADD_ATTR: ["target", "rel"],
    });
  }

  return rawHtml;
}
