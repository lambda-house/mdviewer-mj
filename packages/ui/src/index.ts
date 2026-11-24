// @lambda-house/ui: controls shared by MDViewer and Agent MCR. Styles are in
// ../ui.css (import '@lambda-house/ui/ui.css' after the tokens); colours and
// sizes come from @lambda-house/tokens. Shared UI spec, phase 2.

export { cx } from './cx';
export { PLATFORM, ACTION_BUTTON_FIRST, type Platform } from './platform';
export { Button, type ButtonProps } from './Button';
export { Kbd, Badge, Notice, SettingRow, DescList, StatusDot, ScrollArea, EmptyState } from './display';
export { Dialog, ConfirmDialog, type DialogProps, type ConfirmDialogProps } from './Dialog';
export { SplitHandle, HANDLE_STEP, type SplitHandleProps } from './SplitHandle';
export { Segmented, type SegmentedOption, type SegmentedProps } from './Segmented';
export { Tabs, type TabItem, type TabsProps } from './Tabs';
export { Menu, type MenuItem, type MenuProps } from './Menu';
export { PaneFrame, type PaneFrameProps } from './PaneFrame';
export { useSmoothWheelScroll } from './useSmoothWheelScroll';
export { formatAge } from './format';
export { keepSame } from './keepSame';
