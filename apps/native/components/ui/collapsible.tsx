import { cn } from '@/lib/utils';
import * as CollapsiblePrimitive from '@rn-primitives/collapsible';
import * as React from 'react';

const Collapsible = CollapsiblePrimitive.Root;

const CollapsibleTrigger = React.forwardRef<
  CollapsiblePrimitive.TriggerRef,
  CollapsiblePrimitive.TriggerProps
>(({ className, ...props }, ref) => (
  <CollapsiblePrimitive.Trigger
    ref={ref}
    className={cn('flex flex-row items-center', className)}
    {...props}
  />
));
CollapsibleTrigger.displayName = 'CollapsibleTrigger';

const CollapsibleContent = React.forwardRef<
  CollapsiblePrimitive.ContentRef,
  CollapsiblePrimitive.ContentProps
>(({ className, ...props }, ref) => (
  <CollapsiblePrimitive.Content ref={ref} className={cn('overflow-hidden', className)} {...props} />
));
CollapsibleContent.displayName = 'CollapsibleContent';

export { Collapsible, CollapsibleTrigger, CollapsibleContent };
