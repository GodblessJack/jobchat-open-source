import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true
});

const defaultLinkRender =
  md.renderer.rules.link_open ||
  function (tokens, idx, options, _env, self) {
    return self.renderToken(tokens, idx, options);
  };

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx].attrSet('target', '_blank');
  tokens[idx].attrSet('rel', 'noopener noreferrer');
  return defaultLinkRender(tokens, idx, options, env, self);
};

// Custom fence renderer: wrap fenced code blocks in a header with the
// language label + copy button. The actual copy interaction is wired in
// MessageRenderer via a delegated click listener.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

md.renderer.rules.fence = (tokens, idx) => {
  const token = tokens[idx];
  const info = (token.info || '').trim();
  const lang = info.split(/\s+/)[0] || 'text';
  const content = token.content;
  // base64-encode the raw content to safely round-trip through a data attribute.
  // (Avoid escapeHtml here — encodeURIComponent already neutralizes quotes/brackets.)
  const encoded = encodeURIComponent(content);
  return (
    `<div class="chat-codeblock" data-lang="${escapeHtml(lang)}">` +
    `<div class="chat-codeblock-header"><span class="chat-codeblock-lang">${escapeHtml(lang)}</span>` +
    `<button type="button" class="chat-codeblock-copy" data-copy="${encoded}" aria-label="复制代码">复制</button></div>` +
    `<pre><code class="language-${escapeHtml(lang)}">${escapeHtml(content)}</code></pre>` +
    `</div>`
  );
};

export function renderMarkdown(text: string): string {
  return md.render(text);
}
