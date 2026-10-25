import React from 'react';

// src/components/ui/TextArea.tsx
// 全仓唯一的文本域实现。外观完全交给调用方（原因同 TextField）。

export type TextAreaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const TextArea = React.forwardRef<HTMLTextAreaElement, TextAreaProps>(({ className, ...rest }, ref) => (
    <textarea ref={ref} {...rest} className={className} />
));

TextArea.displayName = 'TextArea';
export default TextArea;
