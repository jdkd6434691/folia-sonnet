import React from 'react';

// src/components/ui/Checkbox.tsx
// 全仓唯一的复选框实现。外观完全交给调用方（原因同 TextField）。

export type CheckboxProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(({ className, ...rest }, ref) => (
    <input ref={ref} type="checkbox" {...rest} className={className} />
));

Checkbox.displayName = 'Checkbox';
export default Checkbox;
