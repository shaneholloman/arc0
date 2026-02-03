import { Text } from '@/components/ui/text';
import { View } from 'react-native';
import { Fragment } from 'react';

interface MarkdownContentProps {
  content: string;
}

export function MarkdownContent({ content }: MarkdownContentProps) {
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let key = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines but add spacing
    if (!trimmed) {
      elements.push(<View key={key++} className="h-2" />);
      continue;
    }

    // Headers
    if (trimmed.startsWith('### ')) {
      elements.push(
        <Text key={key++} className="text-foreground mt-3 mb-1 text-base font-semibold">
          {trimmed.slice(4)}
        </Text>
      );
      continue;
    }
    if (trimmed.startsWith('## ')) {
      elements.push(
        <Text key={key++} className="text-foreground mt-4 mb-2 text-lg font-semibold">
          {trimmed.slice(3)}
        </Text>
      );
      continue;
    }
    if (trimmed.startsWith('# ')) {
      elements.push(
        <Text key={key++} className="text-foreground mt-4 mb-2 text-xl font-bold">
          {trimmed.slice(2)}
        </Text>
      );
      continue;
    }

    // Bullet points
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      const indent = line.length - line.trimStart().length;
      const indentLevel = Math.floor(indent / 2);
      elements.push(
        <View key={key++} className="mt-1 flex-row" style={{ paddingLeft: indentLevel * 12 }}>
          <Text className="text-muted-foreground mr-2">•</Text>
          <Text className="text-foreground flex-1 text-sm leading-relaxed">
            {renderInlineFormatting(trimmed.slice(2))}
          </Text>
        </View>
      );
      continue;
    }

    // Numbered lists
    const numberedMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
    if (numberedMatch) {
      elements.push(
        <View key={key++} className="mt-1 flex-row">
          <Text className="text-muted-foreground mr-2 w-5">{numberedMatch[1]}.</Text>
          <Text className="text-foreground flex-1 text-sm leading-relaxed">
            {renderInlineFormatting(numberedMatch[2])}
          </Text>
        </View>
      );
      continue;
    }

    // Code blocks (simple detection)
    if (trimmed.startsWith('```')) {
      // Find the end of the code block
      let codeContent = '';
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeContent += (codeContent ? '\n' : '') + lines[i];
        i++;
      }
      elements.push(
        <View key={key++} className="bg-muted mt-2 mb-2 rounded-lg p-3">
          <Text className="text-foreground font-mono text-xs">{codeContent}</Text>
        </View>
      );
      continue;
    }

    // Inline code blocks
    if (trimmed.startsWith('`') && trimmed.endsWith('`') && trimmed.length > 2) {
      elements.push(
        <Text
          key={key++}
          className="bg-muted text-foreground mt-1 rounded px-1.5 py-0.5 font-mono text-xs">
          {trimmed.slice(1, -1)}
        </Text>
      );
      continue;
    }

    // Regular paragraph
    elements.push(
      <Text key={key++} className="text-foreground mt-1 text-sm leading-relaxed">
        {renderInlineFormatting(trimmed)}
      </Text>
    );
  }

  return <View className="gap-0">{elements}</View>;
}

// Render inline formatting (bold, italic, code)
function renderInlineFormatting(text: string): React.ReactNode {
  // Simple pattern matching for inline code, bold, and italic
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let partKey = 0;

  while (remaining.length > 0) {
    // Check for inline code
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      parts.push(
        <Text key={partKey++} className="bg-muted rounded px-1 font-mono text-xs">
          {codeMatch[1]}
        </Text>
      );
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // Check for bold
    const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/);
    if (boldMatch) {
      parts.push(
        <Text key={partKey++} className="font-bold">
          {boldMatch[1]}
        </Text>
      );
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // Check for italic (single asterisk)
    const italicMatch = remaining.match(/^\*([^*]+)\*/);
    if (italicMatch) {
      parts.push(
        <Text key={partKey++} className="italic">
          {italicMatch[1]}
        </Text>
      );
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    // Find next special character or consume until end
    const nextSpecial = remaining.search(/[`*]/);
    if (nextSpecial === -1) {
      parts.push(<Fragment key={partKey++}>{remaining}</Fragment>);
      break;
    } else if (nextSpecial === 0) {
      // Special char that didn't match a pattern, consume it
      parts.push(<Fragment key={partKey++}>{remaining[0]}</Fragment>);
      remaining = remaining.slice(1);
    } else {
      parts.push(<Fragment key={partKey++}>{remaining.slice(0, nextSpecial)}</Fragment>);
      remaining = remaining.slice(nextSpecial);
    }
  }

  return parts.length === 1 ? parts[0] : <>{parts}</>;
}
