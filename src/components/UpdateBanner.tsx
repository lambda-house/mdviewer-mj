import React, { useState } from 'react';
import { Download, X } from 'lucide-react';
import { useStore } from '../store';
import { installUpdate } from '../utils/tauri';

/** Bar under the toolbar announcing a newer version found by the update check. */
const UpdateBanner: React.FC = () => {
  const update = useStore((s) => s.availableUpdate);
  const setAvailableUpdate = useStore((s) => s.setAvailableUpdate);
  const [installing, setInstalling] = useState(false);

  if (!update) return null;

  const install = async () => {
    // Installing restarts the app (on Windows the installer closes it)
    const unsaved = useStore.getState().tabs.filter((tab) => tab.isDirty);
    if (unsaved.length > 0) {
      alert(`Save or close these documents first, the app restarts to update:\n${unsaved.map((tab) => tab.title).join('\n')}`);
      return;
    }
    setInstalling(true);
    try {
      await installUpdate();
    } catch (error) {
      setInstalling(false);
      const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error);
      alert(`The update failed:\n${message}`);
    }
  };

  return (
    <div className="update-banner" role="status">
      <Download size={14} aria-hidden="true" />
      <span>
        {installing
          ? `Downloading MDViewer ${update.version}…`
          : `MDViewer ${update.version} is available (you have ${update.currentVersion}).`}
      </span>
      {!installing && (
        <>
          <button type="button" className="update-banner-install" onClick={install}>Install and restart</button>
          <button type="button" className="update-banner-close" onClick={() => setAvailableUpdate(null)} aria-label="Later" title="Later">
            <X size={14} />
          </button>
        </>
      )}
    </div>
  );
};

export default UpdateBanner;
