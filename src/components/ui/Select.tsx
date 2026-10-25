// src/components/ui/Select.tsx
// 下拉框统一入口：复用既有的 CustomSelect，不另写一套。新代码从 '@/components/ui' 引 Select。

export { CustomSelect as Select } from '../shared/CustomSelect';
export type { CustomSelectOption as SelectOption } from '../shared/CustomSelectMenu';
