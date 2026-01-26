import { Text } from '@/components/ui/text';
import type { StructuredPatch } from '@/lib/types/session';
import { cn } from '@/lib/utils';
import { ScrollView, View } from 'react-native';

interface DiffViewProps {
  patches: StructuredPatch[];
}

interface DiffLineProps {
  line: string;
  lineNumber?: number;
}

function DiffLine({ line, lineNumber }: DiffLineProps) {
  const isAddition = line.startsWith('+');
  const isDeletion = line.startsWith('-');
  const isHunk = line.startsWith('@@');

  // Get the prefix (+, -, or space) and the content separately
  const prefix = line[0] || '';
  const content = line.slice(1);

  return (
    <View
      className={cn(
        'flex-row',
        isAddition && 'bg-green-900/30',
        isDeletion && 'bg-red-900/30',
        isHunk && 'bg-accent/20'
      )}
    >
      {lineNumber !== undefined && (
        <Text className="w-8 px-1 text-right font-mono text-xs text-muted-foreground">
          {lineNumber}
        </Text>
      )}
      <Text
        className={cn(
          'w-5 font-mono text-xs',
          isAddition && 'text-green-500',
          isDeletion && 'text-red-500',
          isHunk && 'text-accent-foreground',
          !isAddition && !isDeletion && !isHunk && 'text-muted-foreground'
        )}
      >
        {prefix}
      </Text>
      <Text
        className={cn(
          'flex-1 pr-2 font-mono text-xs',
          isHunk && 'text-accent-foreground',
          !isHunk && 'text-foreground'
        )}
      >
        {isHunk ? line : content}
      </Text>
    </View>
  );
}

export function DiffView({ patches }: DiffViewProps) {
  if (!patches || patches.length === 0) {
    return (
      <View className="rounded-sm border border-border bg-muted/30 px-3 py-2">
        <Text className="text-xs text-muted-foreground italic">No diff available</Text>
      </View>
    );
  }

  return (
    <View className="overflow-hidden rounded-sm border border-border">
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View className="min-w-full">
          {patches.map((patch, patchIndex) => {
            // Track line numbers properly based on line type
            let oldLineNum = patch.oldStart;
            let newLineNum = patch.newStart;

            return (
              <View key={patchIndex}>
                <DiffLine
                  line={`@@ -${patch.oldStart},${patch.oldLines} +${patch.newStart},${patch.newLines} @@`}
                />
                {patch.lines.map((line, lineIndex) => {
                  const isAddition = line.startsWith('+');
                  const isDeletion = line.startsWith('-');
                  let lineNum: number | undefined;

                  if (isAddition) {
                    lineNum = newLineNum;
                    newLineNum++;
                  } else if (isDeletion) {
                    lineNum = oldLineNum;
                    oldLineNum++;
                  } else {
                    // Context line - increment both
                    oldLineNum++;
                    newLineNum++;
                  }

                  return <DiffLine key={lineIndex} line={line} lineNumber={lineNum} />;
                })}
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}
