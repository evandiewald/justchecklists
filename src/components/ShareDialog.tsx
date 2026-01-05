import React, { useState, useEffect } from 'react';
import { ShareLinkManager } from '../utils/shareLinks';
import '../styles/ShareDialog.css';

interface ChecklistShare {
  userId: string;
  email?: string;
  role: 'OWNER' | 'EDITOR' | 'VIEWER';
  sharedBy?: string;
  createdAt?: string;
}

interface ShareDialogProps {
  checklistId: string;
  checklistTitle: string;
  isPublic: boolean;
  userRole: 'OWNER' | 'EDITOR' | 'VIEWER' | null;
  user: any;
  onClose: () => void;
  onLeave?: () => void;
}

export const ShareDialog: React.FC<ShareDialogProps> = ({
  checklistId,
  checklistTitle,
  isPublic,
  userRole,
  user,
  onClose,
  onLeave,
}) => {
  const [shares, setShares] = useState<ChecklistShare[]>([]);
  const [shareLinks, setShareLinks] = useState<{
    editor: string;
    viewer: string;
  }>({
    editor: '',
    viewer: '',
  });
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState<'editor' | 'viewer' | null>(null);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);

  useEffect(() => {
    loadShares();
  }, [checklistId]);

  const loadShares = async () => {
    setLoading(true);
    try {
      const checklistShares = await ShareLinkManager.getChecklistShares(checklistId);
      setShares(checklistShares as ChecklistShare[]);
    } catch (error) {
      console.error('Error loading shares:', error);
    } finally {
      setLoading(false);
    }
  };

  const generateLink = async (role: 'EDITOR' | 'VIEWER') => {
    setGenerating(role);
    try {
      const link = await ShareLinkManager.generateLink(checklistId, role, user);
      setShareLinks((prev) => ({
        ...prev,
        [role.toLowerCase()]: link,
      }));
    } catch (error) {
      console.error('Error generating share link:', error);
      alert('Failed to generate share link. Please try again.');
    } finally {
      setGenerating(null);
    }
  };

  const copyToClipboard = async (link: string, role: string) => {
    try {
      await navigator.clipboard.writeText(link);
      setCopiedLink(role);
      setTimeout(() => setCopiedLink(null), 2000);
    } catch (error) {
      console.error('Error copying to clipboard:', error);
      alert('Failed to copy link. Please copy it manually.');
    }
  };

  const removeUser = async (userId: string) => {
    if (!window.confirm('Are you sure you want to remove this user?')) {
      return;
    }

    try {
      await ShareLinkManager.removeShare(checklistId, userId);
      await loadShares();
    } catch (error) {
      console.error('Error removing user:', error);
      alert('Failed to remove user. Please try again.');
    }
  };

  const handleLeave = async () => {
    if (
      !window.confirm(
        'Are you sure you want to leave this shared list? You will lose access unless invited again.'
      )
    ) {
      return;
    }

    try {
      await ShareLinkManager.leaveSharedList(checklistId, user);
      onLeave?.();
    } catch (error) {
      console.error('Error leaving shared list:', error);
      alert('Failed to leave shared list. Please try again.');
    }
  };

  const handleTogglePublic = async (makePublic: boolean) => {
    try {
      await ShareLinkManager.togglePublicStatus(checklistId, makePublic);
      window.location.reload(); // Refresh to show updated state
    } catch (error) {
      console.error('Error toggling public status:', error);
      alert('Failed to update list visibility. Please try again.');
    }
  };

  const isOwner = userRole === 'OWNER';

  return (
    <div className="share-dialog-overlay" onClick={onClose}>
      <div className="share-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="share-dialog-header">
          <h2>Share "{checklistTitle}"</h2>
          <button className="close-button" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="share-dialog-content">
          {isOwner && (
            <div className="share-section">
              <h3>Public Template</h3>
              <p className="section-description">
                {isPublic
                  ? 'This list is public. Anyone can view and copy it.'
                  : 'Make this list public so anyone can view and copy it as a template.'}
              </p>
              {isPublic ? (
                <button
                  className="generate-link-button"
                  onClick={() => handleTogglePublic(false)}
                  style={{ backgroundColor: '#dc3545' }}
                >
                  Make Private
                </button>
              ) : (
                <button
                  className="generate-link-button"
                  onClick={() => handleTogglePublic(true)}
                >
                  Make Public Template
                </button>
              )}
            </div>
          )}

          {isPublic && (
            <div className="divider"></div>
          )}

          {isOwner && !isPublic && (
            <>
              <div className="share-section">
                <h3>Share via Link</h3>
                <p className="section-description">
                  Generate a link to share this list with others
                </p>

                <div className="share-link-group">
                  <div className="share-link-header">
                    <strong>Editor Access</strong>
                    <span className="role-description">
                      Can edit items and sections, but cannot delete the list or manage sharing
                    </span>
                  </div>
                  {!shareLinks.editor ? (
                    <button
                      className="generate-link-button"
                      onClick={() => generateLink('EDITOR')}
                      disabled={generating !== null}
                    >
                      {generating === 'editor' ? 'Generating...' : 'Generate Editor Link'}
                    </button>
                  ) : (
                    <div className="share-link-display">
                      <input
                        type="text"
                        value={shareLinks.editor}
                        readOnly
                        className="share-link-input"
                      />
                      <button
                        className="copy-button"
                        onClick={() => copyToClipboard(shareLinks.editor, 'editor')}
                      >
                        {copiedLink === 'editor' ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                  )}
                </div>

                <div className="share-link-group">
                  <div className="share-link-header">
                    <strong>Viewer Access</strong>
                    <span className="role-description">Read-only access, cannot make any changes</span>
                  </div>
                  {!shareLinks.viewer ? (
                    <button
                      className="generate-link-button"
                      onClick={() => generateLink('VIEWER')}
                      disabled={generating !== null}
                    >
                      {generating === 'viewer' ? 'Generating...' : 'Generate Viewer Link'}
                    </button>
                  ) : (
                    <div className="share-link-display">
                      <input
                        type="text"
                        value={shareLinks.viewer}
                        readOnly
                        className="share-link-input"
                      />
                      <button
                        className="copy-button"
                        onClick={() => copyToClipboard(shareLinks.viewer, 'viewer')}
                      >
                        {copiedLink === 'viewer' ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="divider"></div>
            </>
          )}
          
          <div className="share-section">
            <h3>Who has access</h3>
            {loading ? (
              <p>Loading...</p>
            ) : shares.length === 0 ? (
              <p className="no-shares">No one has access yet</p>
            ) : (
              <div className="shares-list">
                {shares.map((share) => (
                  <div key={share.userId} className="share-item">
                    <div className="share-item-info">
                      <span className="share-user">{share.email || share.userId}</span>
                      <span className={`role-badge role-${share.role.toLowerCase()}`}>
                        {share.role}
                      </span>
                    </div>
                    {isOwner && share.role !== 'OWNER' && (
                      <button
                        className="remove-button"
                        onClick={() => removeUser(share.userId)}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {!isOwner && (
            <>
              <div className="divider"></div>
              <div className="leave-section">
                <button className="leave-button" onClick={handleLeave}>
                  Leave this list
                </button>
                <p className="leave-description">
                  You will lose access and need to be invited again
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
