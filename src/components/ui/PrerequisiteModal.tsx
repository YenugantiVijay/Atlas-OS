import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Plus } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

export interface PrerequisiteInfo {
  type: 'customer' | 'product';
  title: string;
  message: string;
  actionRoute: string;
  actionLabel: string;
}

export interface PrerequisiteModalProps {
  prerequisite?: PrerequisiteInfo | null;
  isOpen?: boolean;
  onClose: () => void;
  title?: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export const PrerequisiteModal: React.FC<PrerequisiteModalProps> = ({
  prerequisite,
  isOpen,
  onClose,
  title,
  message,
  actionLabel,
  onAction,
}) => {
  const navigate = useNavigate();

  const isModalOpen = isOpen !== undefined ? isOpen : !!prerequisite;
  if (!isModalOpen) return null;

  const resolvedTitle = title || prerequisite?.title || 'Prerequisite Missing';
  const resolvedMessage = message || prerequisite?.message || '';
  const resolvedActionLabel = actionLabel || prerequisite?.actionLabel || 'Proceed';

  const handleAction = () => {
    if (onAction) {
      onAction();
    } else if (prerequisite?.actionRoute) {
      onClose();
      navigate(prerequisite.actionRoute);
    } else {
      onClose();
    }
  };

  return (
    <Modal isOpen={isModalOpen} onClose={onClose} title={resolvedTitle} maxWidth="sm">
      <div className="space-y-4 py-2">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-700 shrink-0">
            <AlertCircle className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <p className="text-sm text-content-secondary leading-relaxed">
              {resolvedMessage}
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            leftIcon={<Plus className="w-4 h-4" />}
            onClick={handleAction}
          >
            {resolvedActionLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
