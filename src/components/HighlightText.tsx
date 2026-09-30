import React from 'react';

interface HighlightTextProps {
  text: string;
  query: string;
  className?: string;
  highlightClassName?: string;
}

export const HighlightText: React.FC<HighlightTextProps> = ({
  text,
  query,
  className = '',
  highlightClassName = 'bg-[#FDE047] text-[#1E293B] font-bold px-0.5 rounded-xs ring-1 ring-yellow-400/60 shadow-xs',
}) => {
  if (!query || !query.trim() || !text) {
    return <span className={className}>{text}</span>;
  }

  const terms = query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

  if (terms.length === 0) {
    return <span className={className}>{text}</span>;
  }

  const splitRegex = new RegExp(`(${terms.join('|')})`, 'gi');
  const matchRegex = new RegExp(`^(${terms.join('|')})$`, 'i');
  const parts = text.split(splitRegex);

  return (
    <span className={className}>
      {parts.map((part, index) =>
        matchRegex.test(part) ? (
          <mark key={index} className={highlightClassName}>
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </span>
  );
};
