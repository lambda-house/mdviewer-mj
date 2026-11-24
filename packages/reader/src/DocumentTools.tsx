import { useState } from 'react';
import { Download, Edit3 } from 'lucide-react';
import { cx } from '@lambda-house/ui';
import { useCommandTitle } from '@lambda-house/workbench';
import { useReader, useReaderContext } from './host';
import { activeTabOf, focusedGroupOf } from './store';
import { exportActiveDocument } from './export';

/**
 * The toolbar's tools for the focused group's document: edit it and export it
 * as HTML. Top bar buttons, for the app's tool group; their tooltips name the
 * keys of the window's commands.
 */
export function DocumentTools() {
  const reader = useReaderContext();
  const activeTab = useReader((s) => activeTabOf(focusedGroupOf(s)));
  const editMode = useReader((s) => s.editMode);
  const [exporting, setExporting] = useState(false);
  const editTitle = useCommandTitle('edit.editDocument', editMode ? 'Close editor' : 'Edit document');

  const exportHtml = async () => {
    setExporting(true);
    try {
      await exportActiveDocument(reader, 'html');
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <button
        className={cx('wb-tool', editMode && 'active')}
        onClick={() => reader.store.getState().toggleEditMode()}
        title={editTitle}
      >
        <Edit3 size={16} />
      </button>
      <button
        className={cx('wb-tool', exporting && 'active')}
        onClick={exportHtml}
        disabled={!activeTab || exporting}
        title={activeTab ? 'Export as HTML' : 'No document to export'}
      >
        <Download size={16} />
      </button>
    </>
  );
}
