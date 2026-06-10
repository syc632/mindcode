const codeFencePattern = /```[ \t]*([a-zA-Z0-9_-]*)[ \t]*(?:\r?\n)([\s\S]*?)```/g;

function normalizeLanguage(language) {
  return language.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

function splitBlocks(text) {
  const value = String(text || "").replace(/\r\n/g, "\n");
  const blocks = [];
  let cursor = 0;
  let match;

  while ((match = codeFencePattern.exec(value))) {
    if (match.index > cursor) {
      blocks.push({ type: "text", value: value.slice(cursor, match.index) });
    }

    blocks.push({
      type: "code",
      language: normalizeLanguage(match[1] || ""),
      value: match[2].replace(/\n$/, ""),
    });
    cursor = match.index + match[0].length;
  }

  if (cursor < value.length) {
    blocks.push({ type: "text", value: value.slice(cursor) });
  }

  return blocks.length ? blocks : [{ type: "text", value }];
}

function renderInlineTokens(value, keyPrefix) {
  const nodes = [];
  let cursor = 0;
  let tokenIndex = 0;

  function pushText(until) {
    if (until > cursor) nodes.push(value.slice(cursor, until));
  }

  while (cursor < value.length) {
    const codeIndex = value.indexOf("`", cursor);
    const boldIndex = value.indexOf("**", cursor);
    const nextIndex = [codeIndex, boldIndex].filter((index) => index !== -1).sort((a, b) => a - b)[0];

    if (nextIndex === undefined) {
      pushText(value.length);
      break;
    }

    pushText(nextIndex);

    if (nextIndex === codeIndex) {
      const endIndex = value.indexOf("`", codeIndex + 1);
      if (endIndex === -1) {
        nodes.push(value.slice(codeIndex));
        break;
      }

      nodes.push(
        <code className="markdown-inline-code" key={`${keyPrefix}-code-${tokenIndex}`}>
          {value.slice(codeIndex + 1, endIndex)}
        </code>,
      );
      cursor = endIndex + 1;
      tokenIndex += 1;
      continue;
    }

    const endIndex = value.indexOf("**", boldIndex + 2);
    if (endIndex === -1) {
      nodes.push(value.slice(boldIndex));
      break;
    }

    nodes.push(
      <strong key={`${keyPrefix}-strong-${tokenIndex}`}>
        {renderInlineTokens(value.slice(boldIndex + 2, endIndex), `${keyPrefix}-strong-${tokenIndex}`)}
      </strong>,
    );
    cursor = endIndex + 2;
    tokenIndex += 1;
  }

  return nodes;
}

function renderText(value, keyPrefix) {
  return value.split("\n").flatMap((line, index, lines) => {
    const nodes = renderInlineTokens(line, `${keyPrefix}-line-${index}`);
    if (index < lines.length - 1) {
      nodes.push(<br key={`${keyPrefix}-br-${index}`} />);
    }
    return nodes;
  });
}

export function MarkdownText({ text, className = "" }) {
  const classNames = ["markdown-text", className].filter(Boolean).join(" ");

  return (
    <div className={classNames}>
      {splitBlocks(text).map((block, index) => {
        if (block.type === "code") {
          const languageClass = block.language ? `language-${block.language}` : undefined;
          return (
            <pre className="markdown-code-block" key={`code-${index}`}>
              <code className={languageClass}>{block.value}</code>
            </pre>
          );
        }

        return (
          <p className="markdown-text-paragraph" key={`text-${index}`}>
            {renderText(block.value, `text-${index}`)}
          </p>
        );
      })}
    </div>
  );
}
