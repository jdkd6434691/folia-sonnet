import React from 'react';

// src/components/ui/TextField.tsx
// 全仓唯一的单行输入框实现。外观完全交给调用方：这里不拼默认样式——Tailwind 的层叠不按书写
// 顺序，默认类会悄悄盖掉调用方的背景/字号（迁移既有输入框时就是外观回退）。

export type TextFieldProps = React.InputHTMLAttributes<HTMLInputElement>;

export const TextField = React.forwardRef<HTMLInputElement, TextFieldProps>(({ className, ...rest }, ref) => (
    <input ref={ref} {...rest} className={className} />
));

TextField.displayName = 'TextField';
export default TextField;
