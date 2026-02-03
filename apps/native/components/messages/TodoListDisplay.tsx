import { Checkbox } from '@/components/ui/checkbox';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';
import { ClockIcon } from 'lucide-react-native';
import { View } from 'react-native';

interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm?: string;
}

interface TodoListDisplayProps {
  todos: TodoItem[];
}

function TodoItemRow({ todo }: { todo: TodoItem }) {
  const isCompleted = todo.status === 'completed';
  const isInProgress = todo.status === 'in_progress';

  return (
    <View className="flex-row items-start py-1.5">
      <View className="mt-0.5 mr-2">
        {isInProgress ? (
          <Icon as={ClockIcon} className="text-muted-foreground size-4" />
        ) : (
          <Checkbox checked={isCompleted} onCheckedChange={() => {}} disabled />
        )}
      </View>
      <Text
        className={cn(
          'flex-1 text-sm leading-relaxed',
          isCompleted ? 'text-muted-foreground' : 'text-foreground'
        )}>
        {todo.content}
      </Text>
    </View>
  );
}

export function TodoListDisplay({ todos }: TodoListDisplayProps) {
  if (!todos || todos.length === 0) {
    return null;
  }

  return (
    <View className="gap-0">
      {todos.map((todo, index) => (
        <TodoItemRow key={index} todo={todo} />
      ))}
    </View>
  );
}
