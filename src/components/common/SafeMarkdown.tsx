import React, { type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy, MessageCircle, Quote, Twitter } from 'lucide-react';

export interface SafeMarkdownProps {
  markdown: string;
  variant?: 'reader' | 'preview';
  blockId?: string;
  active?: boolean;
  quoteAttribution?: string;
  onShareQuoteToX?: (quote: string) => void;
  onShareQuoteToWhatsApp?: (quote: string) => void;
  onCopyQuote?: (quote: string) => void;
}

function textFromReactNode(value: ReactNode): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(textFromReactNode).join('');
  if (React.isValidElement<{ children?: ReactNode }>(value)) {
    return textFromReactNode(value.props.children);
  }
  return '';
}

export function safeMarkdownUrl(url: string, key: string): string {
  const value = url.trim();
  if (!value) return '';
  if (/^(?:javascript|vbscript|file|data):/i.test(value)) return '';
  if (value.startsWith('#')) return value;
  if (value.startsWith('/')) return value.startsWith('//') ? '' : value;

  try {
    const parsed = new URL(value);
    if (key === 'src') return parsed.protocol === 'https:' ? parsed.toString() : '';
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:' || parsed.protocol === 'mailto:') {
      return parsed.toString();
    }
  } catch {
    return '';
  }
  return '';
}

export const SafeMarkdown: React.FC<SafeMarkdownProps> = ({
  markdown,
  variant = 'reader',
  blockId,
  active = false,
  quoteAttribution,
  onShareQuoteToX,
  onShareQuoteToWhatsApp,
  onCopyQuote
}) => {
  const activeClass = active
    ? 'bg-amber-950/25 p-3.5 rounded-2xl border-l-4 border-amber-400 text-white shadow-md'
    : '';
  const components: Components = {
    h1: ({ children }) => (
      <h2
        id={blockId}
        className={`font-display text-2xl sm:text-3xl font-bold text-white mt-8 mb-4 border-b border-slate-800 pb-2 transition-all duration-300 ${active ? 'text-amber-300 pl-2 border-l-4 border-amber-500' : ''}`}
      >
        {children}
      </h2>
    ),
    h2: ({ children }) => (
      <h3
        id={blockId}
        className={`font-display text-xl sm:text-2xl font-bold text-sky-300 mt-7 mb-3 transition-all duration-300 ${active ? 'text-amber-300 pl-2 border-l-4 border-amber-500' : ''}`}
      >
        {children}
      </h3>
    ),
    h3: ({ children }) => (
      <h4
        id={blockId}
        className={`font-display text-lg font-bold text-slate-200 mt-5 mb-2 transition-all duration-300 ${active ? 'text-amber-300 pl-2 border-l-4 border-amber-500' : ''}`}
      >
        {children}
      </h4>
    ),
    h4: ({ children }) => <h5 id={blockId} className="font-display text-base font-bold text-slate-200 mt-4 mb-2">{children}</h5>,
    p: ({ children }) => (
      <p id={blockId} className={`leading-relaxed transition-all duration-300 ${activeClass || 'text-slate-200'}`}>
        {children}
      </p>
    ),
    strong: ({ children }) => <strong className="font-bold text-white">{children}</strong>,
    em: ({ children }) => <em className="italic text-slate-100">{children}</em>,
    a: ({ href, children }) => {
      const safeHref = safeMarkdownUrl(href || '', 'href');
      if (!safeHref) return <span className="text-slate-200">{children}</span>;
      const external = /^https?:/i.test(safeHref);
      return (
        <a
          href={safeHref}
          target={external ? '_blank' : undefined}
          rel={external ? 'noopener noreferrer' : undefined}
          className="text-sky-400 underline decoration-sky-700 underline-offset-2 hover:text-sky-300"
        >
          {children}
        </a>
      );
    },
    img: ({ src, alt }) => {
      const safeSrc = safeMarkdownUrl(typeof src === 'string' ? src : '', 'src');
      if (!safeSrc) return null;
      return (
        <img
          src={safeSrc}
          alt={alt || ''}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="my-6 max-h-[38rem] w-full rounded-2xl border border-slate-800 object-contain shadow-lg"
        />
      );
    },
    ul: ({ children }) => (
      <ul id={blockId} className={`my-4 list-disc space-y-2 pl-6 marker:text-sky-400 ${active ? 'rounded-xl border-l-2 border-amber-500 bg-amber-950/20 p-4 pl-8' : ''}`}>
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol id={blockId} className={`my-4 list-decimal space-y-2 pl-6 marker:text-sky-400 ${active ? 'rounded-xl border-l-2 border-amber-500 bg-amber-950/20 p-4 pl-8' : ''}`}>
        {children}
      </ol>
    ),
    li: ({ children }) => <li className="leading-relaxed text-slate-200">{children}</li>,
    hr: () => <hr id={blockId} className="my-8 border-slate-800" />,
    blockquote: ({ children }) => {
      const quoteText = textFromReactNode(children).trim();
      return (
        <div
          id={blockId}
          className={`group relative my-6 rounded-2xl bg-gradient-to-r from-slate-900/90 via-slate-900/60 to-slate-950/80 border-l-4 p-5 sm:p-6 shadow-md transition-all duration-300 ${active ? 'border-amber-500 ring-1 ring-amber-500/40' : 'border-sky-500'}`}
        >
          <div className="flex items-start gap-3">
            <Quote className={`w-6 h-6 shrink-0 mt-1 opacity-70 ${active ? 'text-amber-400' : 'text-sky-500'}`} />
            <blockquote className="font-serif italic text-slate-200 text-lg sm:text-xl leading-relaxed flex-1 [&>p]:m-0 [&>p]:p-0 [&>p]:border-0 [&>p]:bg-transparent [&>p]:shadow-none">
              {children}
            </blockquote>
          </div>
          {variant === 'reader' && quoteText && (onShareQuoteToX || onShareQuoteToWhatsApp || onCopyQuote) && (
            <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between flex-wrap gap-2 text-xs font-mono">
              <span className="text-slate-400">{quoteAttribution}</span>
              <div className="flex items-center gap-2">
                {onShareQuoteToX && (
                  <button type="button" onClick={() => onShareQuoteToX(quoteText)} className="px-2.5 py-1 rounded-lg bg-slate-950 hover:bg-slate-800 text-sky-400 border border-slate-800 flex items-center gap-1.5 transition-colors cursor-pointer">
                    <Twitter className="w-3 h-3" /><span>Quote on X</span>
                  </button>
                )}
                {onShareQuoteToWhatsApp && (
                  <button type="button" onClick={() => onShareQuoteToWhatsApp(quoteText)} className="px-2.5 py-1 rounded-lg bg-slate-950 hover:bg-slate-800 text-emerald-400 border border-slate-800 flex items-center gap-1.5 transition-colors cursor-pointer">
                    <MessageCircle className="w-3 h-3" /><span>WhatsApp</span>
                  </button>
                )}
                {onCopyQuote && (
                  <button type="button" onClick={() => onCopyQuote(quoteText)} className="p-1 rounded-lg bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800 transition-colors cursor-pointer" title="Copy quote and piece link">
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      );
    }
  };

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      skipHtml
      urlTransform={safeMarkdownUrl}
      components={components}
    >
      {markdown}
    </ReactMarkdown>
  );
};

