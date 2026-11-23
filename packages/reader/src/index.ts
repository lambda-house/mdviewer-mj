// @lambda-house/reader: the Markdown reader and editor shared by MDViewer and
// Agent MCR (shared UI spec §6.1). Phase 5 part 1: rendering, file kinds and
// links, find, scroll anchoring and holding, the editor state registry.
// Part 2: the reader store (createReaderStore: documents, groups, settings).

export * from './types';
export * from './files';
export * from './markdown';
export * from './fb2';
export * from './search';
export * from './scrollAnchor';
export * from './scrollHold';
export * from './editorRegistry';
export * from './store';
export * from './host';
export * from './changes';
export * from './save';
export * from './export';
export { DocumentPanel, MarkdownViewer, ErrorBoundary, type DocumentPanelProps } from './DocumentPanel';
export { SaveAllDialog, CloseDocumentDialog } from './SaveAllDialog';
export { SearchOptionToggles } from './FindBar';
