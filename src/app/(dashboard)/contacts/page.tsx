'use client';

import { useRef, useState } from 'react';
import { IconForms, IconUpload } from '@tabler/icons-react';
import { useCan } from '@/hooks/use-can';
import { useWorkspace } from '@/components/layout/workspace-provider';
import { RecordIndex } from '@/components/records/record-index';
import { ImportModal } from '@/components/contacts/import-modal';
import { CustomFieldsManager } from '@/components/contacts/custom-fields-manager';

const ACTION_BUTTON =
  'flex h-8 items-center gap-1 rounded-sm px-2 text-[13px] text-muted-foreground transition-colors hover:bg-hover hover:text-foreground';

export default function ContactsPage() {
  const canEdit = useCan('send-messages');
  const canEditSettings = useCan('edit-settings');
  const { bumpRevision } = useWorkspace();
  const [importOpen, setImportOpen] = useState(false);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  // RecordIndex hands us its custom-field reload so new fields show up as columns.
  const reloadFields = useRef<(() => void) | null>(null);

  return (
    <>
      <RecordIndex
        object="contacts"
        onFieldsReloadRef={reloadFields}
        extraActions={
          <>
            {canEditSettings && (
              <button type="button" className={ACTION_BUTTON} onClick={() => setFieldsOpen(true)}>
                <IconForms size={16} stroke={1.6} /> <span className="hidden sm:inline">Custom fields</span>
              </button>
            )}
            {canEdit && (
              <button type="button" className={ACTION_BUTTON} onClick={() => setImportOpen(true)}>
                <IconUpload size={16} stroke={1.6} /> <span className="hidden sm:inline">Import</span>
              </button>
            )}
          </>
        }
      />
      <ImportModal
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={() => {
          reloadFields.current?.();
          bumpRevision();
        }}
      />
      <CustomFieldsManager
        open={fieldsOpen}
        onOpenChange={(open) => {
          setFieldsOpen(open);
          if (!open) {
            reloadFields.current?.();
            bumpRevision();
          }
        }}
      />
    </>
  );
}
