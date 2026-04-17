import React from 'react';
import MemoryEditor from './MemoryEditor';
import MoveDialog from './MoveDialog';
import CreateNodeForm from './CreateNodeForm';

interface MemoryBrowserPanelsProps {
  editing: boolean;
  moving: boolean;
  creating: boolean;
  editContent: string;
  setEditContent: (value: string) => void;
  editDisclosure: string;
  setEditDisclosure: (value: string) => void;
  editPriority: number;
  setEditPriority: (value: number) => void;
  saving: boolean;
  cancelEditing: () => void;
  handleSave: () => Promise<void>;
  domain: string;
  path: string;
  navigateTo: (newPath: string, newDomain?: string) => void;
  refreshData: () => Promise<void>;
  setMoving: (value: boolean) => void;
  setCreating: (value: boolean) => void;
}

export default function MemoryBrowserPanels({
  editing,
  moving,
  creating,
  editContent,
  setEditContent,
  editDisclosure,
  setEditDisclosure,
  editPriority,
  setEditPriority,
  saving,
  cancelEditing,
  handleSave,
  domain,
  path,
  navigateTo,
  refreshData,
  setMoving,
  setCreating,
}: MemoryBrowserPanelsProps): React.JSX.Element | null {
  if (!editing && !moving && !creating) return null;

  return (
    <>
      {editing && (
        <MemoryEditor
          editContent={editContent}
          setEditContent={setEditContent}
          editDisclosure={editDisclosure}
          setEditDisclosure={setEditDisclosure}
          editPriority={editPriority}
          setEditPriority={setEditPriority}
          saving={saving}
          onSave={() => void handleSave()}
          onCancel={cancelEditing}
        />
      )}
      {moving && (
        <MoveDialog
          domain={domain}
          path={path}
          onMoved={(nextDomain, nextPath) => {
            setMoving(false);
            navigateTo(nextPath, nextDomain);
          }}
          onCancel={() => setMoving(false)}
        />
      )}
      {creating && (
        <CreateNodeForm
          domain={domain}
          parentPath={path}
          onCreated={() => {
            setCreating(false);
            void refreshData();
          }}
          onCancel={() => setCreating(false)}
        />
      )}
    </>
  );
}
