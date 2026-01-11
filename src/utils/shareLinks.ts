import { fetchAuthSession } from 'aws-amplify/auth';
import { Schema } from '../../amplify/data/resource';
import { generateClient } from 'aws-amplify/api';

const getClient = async () => {
  const session = await fetchAuthSession();
  const token = session.tokens?.idToken?.toString();
  
  if (!token) {
    throw new Error('No authentication token available');
  }

  return generateClient<Schema>({
    authMode: 'lambda',
    authToken: `Token: ${token}`,
  });
}


export class ShareLinkManager {

  static generateShareToken(): string {
    // Crypto-secure 32-byte random token
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  static createShareLink(token: string): string {
    return `${window.location.origin}/share/${token}`;
  }

  static async generateLink(
    checklistId: string,
    role: 'EDITOR' | 'VIEWER',
    user: any
  ): Promise<string> {
    const token = this.generateShareToken();

    const client = await getClient();

    // Create a share record with the token
    await client.models.ChecklistShare.create({
      checklistId,
      userId: `pending_${token}`, // Temporary until link accepted
      email: 'Pending', // Will be replaced when link is accepted
      role,
      shareToken: token,
      sharedBy: user.username || user.userId,
      createdAt: new Date().toISOString(),
    });

    return this.createShareLink(token);
  }

  static async acceptShareLink(token: string, user: any): Promise<string> {
    console.log('Accepting share link with token:', token, 'for user:', user.username || user.userId);

    const client = await getClient();

    // Find share by token
    const shares = await client.models.ChecklistShare.list({
      filter: { shareToken: { eq: token } },
    });

    if (!shares.data || shares.data.length === 0) {
      throw new Error('Invalid or expired share link');
    }

    const share = shares.data[0];
    console.log('Found share:', share);

    // Check if user already has access
    const userId = user.username || user.userId;
    const existingShare = await client.models.ChecklistShare.get({
      checklistId: share.checklistId,
      userId: userId,
    });

    console.log('Existing share check:', existingShare.data);

    if (!existingShare.data) {
      // Create new share for current user
      const userEmail = user.attributes?.email || user.signInDetails?.loginId || user.username || user.userId;
      console.log('Creating new share for user:', userId, 'with role:', share.role, 'email:', userEmail);

      const newShare = await client.models.ChecklistShare.create({
        checklistId: share.checklistId,
        userId: userId,
        email: userEmail,
        role: share.role,
        sharedBy: share.sharedBy,
        createdAt: new Date().toISOString(),
      });

      console.log('Created new share:', newShare.data);
    } else {
      console.log('User already has access, skipping share creation');
    }

    return share.checklistId;
  }

  static async getUserRole(
    checklistId: string,
    user: any
  ): Promise<'OWNER' | 'EDITOR' | 'VIEWER' | null> {
    try {
      const client = await getClient();
      const share = await client.models.ChecklistShare.get({
        checklistId,
        userId: user.username || user.userId,
      });

      return share.data?.role || null;
    } catch (error) {
      console.error('Error getting user role:', error);
      return null;
    }
  }

  static async getChecklistShares(checklistId: string) {
    try {
      const client = await getClient();
      const result = await client.models.ChecklistShare.list({
        filter: { checklistId: { eq: checklistId } },
      });

      // Filter out pending shares (those with userId starting with "pending_")
      return result.data?.filter((share) => !share.userId.startsWith('pending_')) || [];
    } catch (error) {
      console.error('Error getting checklist shares:', error);
      return [];
    }
  }

  static async removeShare(checklistId: string, userId: string) {
    const client = await getClient();
    await client.models.ChecklistShare.delete({
      checklistId,
      userId,
    });
  }

  static async leaveSharedList(checklistId: string, user: any) {
    await this.removeShare(checklistId, user.username || user.userId);
  }

  static async togglePublicStatus(checklistId: string, isPublic: boolean) {
    const client = await getClient();
    await client.models.Checklist.update({
      id: checklistId,
      isPublic: isPublic,
    });
  }
}
