import { Fragment, type ReactNode } from 'react';

interface MarkdownPreviewProps {
  content: string;
}

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const tokenRegex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\((https?:\/\/[^)\s]+)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push(<code key={key++}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith('**') && token.endsWith('**')) {
      nodes.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('*') && token.endsWith('*')) {
      nodes.push(<em key={key++}>{token.slice(1, -1)}</em>);
    } else if (token.startsWith('[') && match[2]) {
      const labelEnd = token.indexOf('](');
      const label = labelEnd > 1 ? token.slice(1, labelEnd) : match[2];
      nodes.push(
        <a
          key={key++}
          href={match[2]}
          target="_blank"
          rel="noopener noreferrer"
        >
          {label}
        </a>,
      );
    } else {
      nodes.push(token);
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

export function MarkdownPreview({ content }: MarkdownPreviewProps) {
  if (!content.trim()) {
    return (
      <div className="markdown-preview">
        <p className="hint">本文はまだありません。</p>
      </div>
    );
  }

  const lines = content.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';

    if (line.startsWith('```')) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? '').startsWith('```')) {
        codeLines.push(lines[i] ?? '');
        i += 1;
      }
      blocks.push(
        <pre key={key++}>
          <code>{codeLines.join('\n')}</code>
        </pre>,
      );
      i += 1;
      continue;
    }

    const headingMatch = /^(#{1,4})\s+(.+)$/.exec(line);
    if (headingMatch) {
      const level = headingMatch[1]?.length ?? 1;
      const text = headingMatch[2] ?? '';
      if (level === 1) blocks.push(<h1 key={key++}>{renderInline(text)}</h1>);
      else if (level === 2) blocks.push(<h2 key={key++}>{renderInline(text)}</h2>);
      else if (level === 3) blocks.push(<h3 key={key++}>{renderInline(text)}</h3>);
      else blocks.push(<h4 key={key++}>{renderInline(text)}</h4>);
      i += 1;
      continue;
    }

    if (line.startsWith('> ')) {
      const quoteLines: string[] = [];
      while (i < lines.length && (lines[i] ?? '').startsWith('> ')) {
        quoteLines.push((lines[i] ?? '').slice(2));
        i += 1;
      }
      blocks.push(
        <blockquote key={key++}>
          {quoteLines.map((q, idx) => (
            <Fragment key={idx}>
              {renderInline(q)}
              {idx < quoteLines.length - 1 ? <br /> : null}
            </Fragment>
          ))}
        </blockquote>,
      );
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i] ?? '')) {
        items.push((lines[i] ?? '').replace(/^[-*]\s+/, ''));
        i += 1;
      }
      blocks.push(
        <ul key={key++}>
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    if (line.trim() === '') {
      i += 1;
      continue;
    }

    const paraLines: string[] = [];
    while (
      i < lines.length &&
      (lines[i] ?? '').trim() !== '' &&
      !(lines[i] ?? '').startsWith('```') &&
      !/^#{1,4}\s+/.test(lines[i] ?? '') &&
      !(lines[i] ?? '').startsWith('> ') &&
      !/^[-*]\s+/.test(lines[i] ?? '')
    ) {
      paraLines.push(lines[i] ?? '');
      i += 1;
    }

    blocks.push(
      <p key={key++}>
        {paraLines.map((p, idx) => (
          <Fragment key={idx}>
            {renderInline(p)}
            {idx < paraLines.length - 1 ? <br /> : null}
          </Fragment>
        ))}
      </p>,
    );
  }

  return <div className="markdown-preview">{blocks}</div>;
}
