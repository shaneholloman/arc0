import { cn } from '@/lib/utils';
import * as ToggleGroupPrimitive from '@rn-primitives/toggle-group';
import { Platform } from 'react-native';
import { TextClassContext } from '@/components/ui/text';

function ToggleGroup({
  className,
  ...props
}: ToggleGroupPrimitive.RootProps & React.RefAttributes<ToggleGroupPrimitive.RootRef>) {
  return (
    <ToggleGroupPrimitive.Root
      className={cn('bg-muted flex-row items-center rounded-md p-0.5', className)}
      {...props}
    />
  );
}

function ToggleGroupItem({
  className,
  ...props
}: ToggleGroupPrimitive.ItemProps & React.RefAttributes<ToggleGroupPrimitive.ItemRef>) {
  return (
    <TextClassContext.Provider
      value={cn(
        'text-muted-foreground text-sm font-medium',
        Platform.select({ web: 'transition-colors' })
      )}>
      <ToggleGroupPrimitive.Item
        className={cn(
          'items-center justify-center rounded px-3.5 py-2',
          'data-[state=on]:bg-background data-[state=on]:shadow-sm',
          Platform.select({
            web: 'focus-visible:ring-ring transition-all focus-visible:ring-1 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50',
          }),
          className
        )}
        {...props}
      />
    </TextClassContext.Provider>
  );
}

export { ToggleGroup, ToggleGroupItem };
