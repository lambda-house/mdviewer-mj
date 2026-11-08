import { Activity, FileText } from 'lucide-react';
import '../styles/workspace-switch.css';

export default function WorkspaceSwitch({ active, onChange }: {
  active: 'documents' | 'sessions';
  onChange: (workspace: 'documents' | 'sessions') => void;
}) {
  return <nav className="workspace-switch" aria-label="Workspace">
    <button type="button" className="workspace-switch-option" aria-current={active === 'documents' ? 'page' : undefined} onClick={() => onChange('documents')}>
      <FileText size={13} aria-hidden="true"/> Documents
    </button>
    <button type="button" className="workspace-switch-option" aria-current={active === 'sessions' ? 'page' : undefined} onClick={() => onChange('sessions')}>
      <Activity size={13} aria-hidden="true"/> Sessions
    </button>
  </nav>;
}
