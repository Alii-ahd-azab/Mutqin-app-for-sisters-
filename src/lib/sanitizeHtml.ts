import DOMPurify from 'dompurify';

// Hook to strictly sanitize style attributes to allowed properties only
if (typeof window !== 'undefined' && DOMPurify && DOMPurify.addHook) {
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.hasAttribute('style')) {
      const style = node.getAttribute('style') || '';
      const safeStyles = style
        .split(';')
        .map((s) => s.trim())
        .filter((s) =>
          /^(color|font-size|font-weight|font-style|text-decoration|text-align|line-height)\s*:/i.test(s)
        )
        .join('; ');

      if (safeStyles) {
        node.setAttribute('style', safeStyles);
      } else {
        node.removeAttribute('style');
      }
    }
  });
}

/**
 * Sanitizes rich text HTML for "خاطرة اليوم" (Thought of the Day).
 * Allows only safe formatting tags and safe CSS style attributes (color, font-size, text-align, etc.).
 * Strictly strips any executable code, scripts, iframes, and event handlers.
 */
export function sanitizeThoughtHtml(rawHtml: string): string {
  if (!rawHtml || typeof rawHtml !== 'string') return '';

  return DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS: [
      'b',
      'strong',
      'i',
      'em',
      'u',
      'span',
      'p',
      'div',
      'br',
      'small',
      'sub',
      'sup',
      'blockquote',
      'h3',
      'h4',
    ],
    ALLOWED_ATTR: ['style', 'class', 'dir'],
    FORBID_TAGS: [
      'script',
      'iframe',
      'object',
      'embed',
      'link',
      'style',
      'form',
      'input',
      'button',
      'svg',
      'math',
      'base',
      'meta',
      'applet',
      'frame',
      'frameset',
    ],
    FORBID_ATTR: [
      'onerror',
      'onload',
      'onclick',
      'onmouseover',
      'onfocus',
      'onblur',
      'onkeydown',
      'onkeyup',
      'href',
      'src',
      'data',
      'action',
      'formaction',
    ],
  });
}

/**
 * Helper to check if the thought HTML contains actual visible text or is effectively empty.
 */
export function isThoughtContentEmpty(html: string | undefined | null): boolean {
  if (!html) return true;
  // Strip all HTML tags, whitespace, and non-breaking space entities
  const textOnly = html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#160;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return textOnly.length === 0;
}
