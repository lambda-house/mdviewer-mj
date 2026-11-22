import { Activity, FileText } from 'lucide-react';
import { Segmented } from '@lambda-house/ui';

type Workspace = 'documents' | 'sessions';

/** Documents | Sessions, at the left of both surfaces' top bars. */
export default function WorkspaceSwitch({ active, onChange }: { active: Workspace; onChange: (workspace: Workspace) => void }) {
  return (
    <Segmented<Workspace>
      label="Workspace"
      value={active}
      onChange={onChange}
      options={[
        { value: 'documents', label: 'Documents', icon: <FileText size={13} /> },
        { value: 'sessions', label: 'Sessions', icon: <Activity size={13} /> },
      ]}
    />
  );
}
