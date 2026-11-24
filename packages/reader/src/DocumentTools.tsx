import { useState } from 'react';
import { Download, Edit3 } from 'lucide-react';
import { cx } from '@lambda-house/ui';
import { useReader, useReaderContext } from './host';
import { activeTabOf, focusedGroupOf } from './store';
import { exportActiveDocument } from './export';

/**
 * The toolbar's tools for the focused group's document: edit it (Ctrl+E) and
 * export it as HTML. Top bar buttons, for the app's tool group.
 */
export function DocumentTools() {
  const reader = useReaderContext();
  const activeTab = useReader((s) => activeTabOf(focusedGroupOf(s)));
  const editMode = useReader((s) => s.editMode);
  const [exporting, setExporting] = useState(false);

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
        title={editMode ? 'Close editor (Ctrl+E)' : 'Edit document (Ctrl+E)'}
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
