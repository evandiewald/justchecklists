import type { AppSyncAuthorizerHandler } from 'aws-lambda';
import {
  DynamoDBClient,
  ListTablesCommand,
  DescribeTableCommand,
  ListTagsOfResourceCommand,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
} from '@aws-sdk/lib-dynamodb';

/* =========================
   DynamoDB setup
========================= */

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

let cachedTableNames: { checklist: string; checklistShare: string; checklistSection: string; checklistItem: string } | null = null;

/* =========================
   Table discovery
========================= */

async function getTableTags(tableArn: string) {
  try {
    const result = await dynamoClient.send(
      new ListTagsOfResourceCommand({ ResourceArn: tableArn })
    );
    return result.Tags || [];
  } catch {
    return [];
  }
}

async function getTableNames() {
  if (cachedTableNames) return cachedTableNames;

  const branch = process.env.AMPLIFY_BRANCH || 'sandbox';
  const isSandbox = branch === 'sandbox';

  const list = await dynamoClient.send(new ListTablesCommand({}));
  const tables = list.TableNames ?? [];

  let checklist: string | undefined;
  let checklistShare: string | undefined;
  let checklistSection: string | undefined;
  let checklistItem: string | undefined;

  for (const name of tables) {
    if (!name.startsWith('Checklist')) continue;

    const desc = await dynamoClient.send(
      new DescribeTableCommand({ TableName: name })
    );

    if (!desc.Table?.TableArn) continue;

    const tags = await getTableTags(desc.Table.TableArn);
    const deploymentType = tags.find(t => t.Key === 'amplify:deployment-type')?.Value;
    const branchName = tags.find(t => t.Key === 'amplify:branch-name')?.Value;

    const match = isSandbox
      ? deploymentType === 'sandbox'
      : deploymentType === 'branch' && branchName === branch;

    if (!match) continue;

    if (name.startsWith('ChecklistShare-')) checklistShare = name;
    else if (name.startsWith('ChecklistSection-')) checklistSection = name;
    else if (name.startsWith('ChecklistItem-')) checklistItem = name;
    else if (name.startsWith('Checklist-')) checklist = name;

    if (checklist && checklistShare && checklistSection && checklistItem) break;
  }

  if (!checklist || !checklistShare || !checklistSection || !checklistItem) {
    console.log('ERROR: Tables not found', { checklist, checklistShare, checklistSection, checklistItem, branch, isSandbox, allTables: tables });
    throw new Error('Checklist tables not found');
  }

  console.log('Table discovery successful:', { checklist, checklistShare, checklistSection, checklistItem, branch, isSandbox });
  cachedTableNames = { checklist, checklistShare, checklistSection, checklistItem };
  return cachedTableNames;
}

/* =========================
   Auth models
========================= */

type Role = 'OWNER' | 'EDITOR' | 'VIEWER';
type Permission = 'read' | 'create' | 'update' | 'delete' | 'subscribe' | 'share';

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  OWNER:  ['read', 'create', 'update', 'delete', 'subscribe', 'share'],
  EDITOR: ['read', 'create', 'update', 'subscribe'],
  VIEWER: ['read', 'subscribe'],
};

/* =========================
   Helpers
========================= */

function decodeJWT(token: string): any | null {
  try {
    const [, payload] = token.split('.');
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function getRootField(query: string): string | null {
  const match = query.match(/\{\s*(\w+)/);
  return match?.[1] ?? null;
}

function logAuth(data: Record<string, any>) {
  console.log(JSON.stringify({
    type: 'AUTHZ',
    ts: new Date().toISOString(),
    ...data,
  }));
}

async function checkChecklistAccess(
  checklistId: string,
  userId: string,
  requiredPermission: Permission,
): Promise<{ authorized: boolean; reason: string; role?: Role }> {
  const tables = await getTableNames();

  const checklistRes = await docClient.send(
    new GetCommand({
      TableName: tables.checklist,
      Key: { id: checklistId },
    })
  );

  const checklist = checklistRes.Item;
  if (!checklist) {
    return { authorized: false, reason: 'checklist_not_found' };
  }

  // Public checklists allow read and subscribe
  if (checklist.isPublic && (requiredPermission === 'read' || requiredPermission === 'subscribe')) {
    return { authorized: true, reason: 'public_checklist' };
  }

  let role: Role | null = null;

  // Check if user is author
  if (checklist.author === userId) {
    role = 'OWNER';
  } else {
    // Check ChecklistShare
    const shareRes = await docClient.send(
      new GetCommand({
        TableName: tables.checklistShare,
        Key: { checklistId, userId },
      })
    );
    if (shareRes.Item) {
      role = shareRes.Item.role;
    }
  }

  if (!role) {
    return { authorized: false, reason: 'no_role' };
  }

  // Check share permission
  if (requiredPermission === 'share' && role !== 'OWNER') {
    return { authorized: false, reason: 'share_requires_owner' };
  }

  // Check role has permission
  if (!ROLE_PERMISSIONS[role].includes(requiredPermission)) {
    return { authorized: false, reason: 'permission_denied', role };
  }

  return { authorized: true, reason: 'authorized', role };
}

/* =========================
   Authorizer
========================= */

export const handler: AppSyncAuthorizerHandler = async (event) => {
  console.log(event);

  const { authorizationToken, requestContext } = event;

  const decoded = decodeJWT(authorizationToken);
  if (!decoded) return { isAuthorized: false };

  const userId =
    decoded['cognito:username'] ||
    decoded.username ||
    decoded.sub;

  if (!userId) return { isAuthorized: false };

  const query = requestContext.queryString || '';
  const variables = requestContext.variables || {};
  const fieldName = getRootField(query);

  // For subscription connections, there's no fieldName yet - just authorize the connection
  if (!fieldName) {
    logAuth({ stage: 'ALLOW', reason: 'subscription_connection', userId });
    return { isAuthorized: true };
  }

  logAuth({
    stage: 'REQUEST',
    userId,
    fieldName,
    variables,
    requestContext: {
      apiId: requestContext.apiId,
      requestId: requestContext.requestId,
    }
  });

  try {
    const tables = await getTableNames();

    // ====================
    // SUBSCRIPTIONS - Allow all
    // ====================
    if (fieldName.startsWith('onCreate') || fieldName.startsWith('onUpdate') || fieldName.startsWith('onDelete')) {
      logAuth({ stage: 'ALLOW', reason: 'subscription', fieldName });
      return { isAuthorized: true };
    }

    // ====================
    // CHECKLIST OPERATIONS
    // ====================

    if (fieldName === 'listChecklists') {
      if (
        variables?.filter?.author?.eq === userId ||
        variables?.filter?.isPublic?.eq === true
      ) {
        logAuth({ stage: 'ALLOW', reason: 'scoped_list' });
        return { isAuthorized: true };
      }
      logAuth({ stage: 'DENY', reason: 'unscoped_list' });
      return { isAuthorized: false };
    }

    if (fieldName === 'createChecklist') {
      logAuth({ stage: 'ALLOW', reason: 'create_checklist' });
      return { isAuthorized: true };
    }

    if (fieldName === 'getChecklist') {
      const checklistId = variables?.id;
      if (!checklistId) {
        logAuth({ stage: 'DENY', reason: 'missing_id' });
        return { isAuthorized: false };
      }

      const result = await checkChecklistAccess(checklistId, userId, 'read');
      logAuth({ stage: result.authorized ? 'ALLOW' : 'DENY', ...result, checklistId });
      return { isAuthorized: result.authorized };
    }

    if (fieldName === 'updateChecklist') {
      const checklistId = variables?.input?.id;
      if (!checklistId) {
        logAuth({ stage: 'DENY', reason: 'missing_id' });
        return { isAuthorized: false };
      }

      const result = await checkChecklistAccess(checklistId, userId, 'update');
      logAuth({ stage: result.authorized ? 'ALLOW' : 'DENY', ...result, checklistId });
      return { isAuthorized: result.authorized };
    }

    if (fieldName === 'deleteChecklist') {
      const checklistId = variables?.input?.id;
      if (!checklistId) {
        logAuth({ stage: 'DENY', reason: 'missing_id' });
        return { isAuthorized: false };
      }

      const result = await checkChecklistAccess(checklistId, userId, 'delete');
      logAuth({ stage: result.authorized ? 'ALLOW' : 'DENY', ...result, checklistId });
      return { isAuthorized: result.authorized };
    }

    // ====================
    // SECTION OPERATIONS
    // ====================

    if (fieldName === 'listChecklistSections') {
      const checklistId = variables?.filter?.checklistId?.eq;
      if (!checklistId) {
        logAuth({ stage: 'DENY', reason: 'missing_checklistId' });
        return { isAuthorized: false };
      }

      const result = await checkChecklistAccess(checklistId, userId, 'read');
      logAuth({ stage: result.authorized ? 'ALLOW' : 'DENY', ...result, checklistId });
      return { isAuthorized: result.authorized };
    }

    if (fieldName === 'createChecklistSection') {
      const checklistId = variables?.input?.checklistId;
      if (!checklistId) {
        logAuth({ stage: 'DENY', reason: 'missing_checklistId' });
        return { isAuthorized: false };
      }

      const result = await checkChecklistAccess(checklistId, userId, 'create');
      logAuth({ stage: result.authorized ? 'ALLOW' : 'DENY', ...result, checklistId });
      return { isAuthorized: result.authorized };
    }

    if (fieldName === 'updateChecklistSection') {
      const sectionId = variables?.input?.id;
      if (!sectionId) {
        logAuth({ stage: 'DENY', reason: 'missing_section_id' });
        return { isAuthorized: false };
      }

      // Look up section to get checklistId
      const sectionRes = await docClient.send(
        new GetCommand({
          TableName: tables.checklistSection,
          Key: { id: sectionId },
        })
      );

      if (!sectionRes.Item?.checklistId) {
        logAuth({ stage: 'DENY', reason: 'section_not_found', sectionId });
        return { isAuthorized: false };
      }

      const result = await checkChecklistAccess(sectionRes.Item.checklistId, userId, 'update');
      logAuth({ stage: result.authorized ? 'ALLOW' : 'DENY', ...result, checklistId: sectionRes.Item.checklistId, sectionId });
      return { isAuthorized: result.authorized };
    }

    if (fieldName === 'deleteChecklistSection') {
      const sectionId = variables?.input?.id;
      if (!sectionId) {
        logAuth({ stage: 'DENY', reason: 'missing_section_id' });
        return { isAuthorized: false };
      }

      // Look up section to get checklistId
      const sectionRes = await docClient.send(
        new GetCommand({
          TableName: tables.checklistSection,
          Key: { id: sectionId },
        })
      );

      if (!sectionRes.Item?.checklistId) {
        logAuth({ stage: 'DENY', reason: 'section_not_found', sectionId });
        return { isAuthorized: false };
      }

      const result = await checkChecklistAccess(sectionRes.Item.checklistId, userId, 'delete');
      logAuth({ stage: result.authorized ? 'ALLOW' : 'DENY', ...result, checklistId: sectionRes.Item.checklistId, sectionId });
      return { isAuthorized: result.authorized };
    }

    // ====================
    // ITEM OPERATIONS
    // ====================

    if (fieldName === 'listChecklistItems') {
      const sectionId = variables?.filter?.sectionId?.eq;
      if (!sectionId) {
        logAuth({ stage: 'DENY', reason: 'missing_sectionId' });
        return { isAuthorized: false };
      }

      // Look up section to get checklistId
      const sectionRes = await docClient.send(
        new GetCommand({
          TableName: tables.checklistSection,
          Key: { id: sectionId },
        })
      );

      if (!sectionRes.Item?.checklistId) {
        logAuth({ stage: 'DENY', reason: 'section_not_found', sectionId });
        return { isAuthorized: false };
      }

      const result = await checkChecklistAccess(sectionRes.Item.checklistId, userId, 'read');
      logAuth({ stage: result.authorized ? 'ALLOW' : 'DENY', ...result, checklistId: sectionRes.Item.checklistId, sectionId });
      return { isAuthorized: result.authorized };
    }

    if (fieldName === 'createChecklistItem') {
      const sectionId = variables?.input?.sectionId;
      if (!sectionId) {
        logAuth({ stage: 'DENY', reason: 'missing_sectionId' });
        return { isAuthorized: false };
      }

      // Look up section to get checklistId
      const sectionRes = await docClient.send(
        new GetCommand({
          TableName: tables.checklistSection,
          Key: { id: sectionId },
        })
      );

      if (!sectionRes.Item?.checklistId) {
        logAuth({ stage: 'DENY', reason: 'section_not_found', sectionId });
        return { isAuthorized: false };
      }

      const result = await checkChecklistAccess(sectionRes.Item.checklistId, userId, 'create');
      logAuth({ stage: result.authorized ? 'ALLOW' : 'DENY', ...result, checklistId: sectionRes.Item.checklistId, sectionId });
      return { isAuthorized: result.authorized };
    }

    if (fieldName === 'updateChecklistItem') {
      const itemId = variables?.input?.id;
      if (!itemId) {
        logAuth({ stage: 'DENY', reason: 'missing_item_id' });
        return { isAuthorized: false };
      }

      // Look up the item to get its sectionId
      const itemRes = await docClient.send(
        new GetCommand({
          TableName: tables.checklistItem,
          Key: { id: itemId },
        })
      );

      if (!itemRes.Item?.sectionId) {
        logAuth({ stage: 'DENY', reason: 'item_not_found', itemId });
        return { isAuthorized: false };
      }

      const sectionId = itemRes.Item.sectionId;

      // Now look up the section to get checklistId
      const sectionRes = await docClient.send(
        new GetCommand({
          TableName: tables.checklistSection,
          Key: { id: sectionId },
        })
      );

      if (!sectionRes.Item?.checklistId) {
        logAuth({ stage: 'DENY', reason: 'section_not_found', sectionId });
        return { isAuthorized: false };
      }

      const result = await checkChecklistAccess(sectionRes.Item.checklistId, userId, 'update');
      logAuth({ stage: result.authorized ? 'ALLOW' : 'DENY', ...result, checklistId: sectionRes.Item.checklistId, sectionId, itemId });
      return { isAuthorized: result.authorized };
    }

    if (fieldName === 'deleteChecklistItem') {
      const itemId = variables?.input?.id;
      if (!itemId) {
        logAuth({ stage: 'DENY', reason: 'missing_item_id' });
        return { isAuthorized: false };
      }

      // Look up the item to get its sectionId
      const itemRes = await docClient.send(
        new GetCommand({
          TableName: tables.checklistItem,
          Key: { id: itemId },
        })
      );

      if (!itemRes.Item?.sectionId) {
        logAuth({ stage: 'DENY', reason: 'item_not_found', itemId });
        return { isAuthorized: false };
      }

      const sectionId = itemRes.Item.sectionId;

      // Now look up the section to get checklistId
      const sectionRes = await docClient.send(
        new GetCommand({
          TableName: tables.checklistSection,
          Key: { id: sectionId },
        })
      );

      if (!sectionRes.Item?.checklistId) {
        logAuth({ stage: 'DENY', reason: 'section_not_found', sectionId });
        return { isAuthorized: false };
      }

      const result = await checkChecklistAccess(sectionRes.Item.checklistId, userId, 'delete');
      logAuth({ stage: result.authorized ? 'ALLOW' : 'DENY', ...result, checklistId: sectionRes.Item.checklistId, sectionId, itemId });
      return { isAuthorized: result.authorized };
    }

    // ====================
    // SHARE OPERATIONS
    // ====================

    if (fieldName.startsWith('listChecklistShare')) {
      // Allow listing your own shares
      if (
        variables?.userId === userId ||
        variables?.filter?.userId?.eq === userId ||
        variables?.filter?.shareToken?.eq
      ) {
        logAuth({ stage: 'ALLOW', reason: 'share_list_own' });
        return { isAuthorized: true };
      }

      // Allow listing shares by checklistId if you're the owner
      const checklistId = variables?.filter?.checklistId?.eq;
      if (checklistId) {
        const checklistRes = await docClient.send(
          new GetCommand({
            TableName: tables.checklist,
            Key: { id: checklistId },
          })
        );

        if (checklistRes.Item && checklistRes.Item.author === userId) {
          logAuth({ stage: 'ALLOW', reason: 'owner_listing_shares', checklistId });
          return { isAuthorized: true };
        }
      }

      logAuth({ stage: 'DENY', reason: 'invalid_share_list' });
      return { isAuthorized: false };
    }

    if (fieldName === 'getChecklistShare') {
      const requestedUserId = variables?.userId;
      if (requestedUserId === userId) {
        logAuth({ stage: 'ALLOW', reason: 'get_own_share' });
        return { isAuthorized: true };
      }

      logAuth({ stage: 'DENY', reason: 'cannot_get_other_share' });
      return { isAuthorized: false };
    }

    if (fieldName === 'createChecklistShare') {
      const shareUserId = variables?.input?.userId;
      const checklistId = variables?.input?.checklistId;

      // If creating a share for yourself, allow it
      if (shareUserId === userId) {
        logAuth({ stage: 'ALLOW', reason: 'create_own_share', checklistId });
        return { isAuthorized: true };
      }

      // If creating a share for SOMEONE ELSE, must be checklist author
      if (checklistId) {
        const checklistRes = await docClient.send(
          new GetCommand({
            TableName: tables.checklist,
            Key: { id: checklistId },
          })
        );

        if (checklistRes.Item && checklistRes.Item.author === userId) {
          logAuth({ stage: 'ALLOW', reason: 'author_creating_share', checklistId });
          return { isAuthorized: true };
        }
      }

      logAuth({ stage: 'DENY', reason: 'not_authorized_to_create_share' });
      return { isAuthorized: false };
    }

    if (fieldName === 'updateChecklistShare' || fieldName === 'deleteChecklistShare') {
      const checklistId = variables?.checklistId || variables?.input?.checklistId;
      if (checklistId) {
        const checklistRes = await docClient.send(
          new GetCommand({
            TableName: tables.checklist,
            Key: { id: checklistId },
          })
        );

        if (checklistRes.Item && checklistRes.Item.author === userId) {
          logAuth({ stage: 'ALLOW', reason: 'author_managing_share', checklistId, action: fieldName });
          return { isAuthorized: true };
        }
      }

      logAuth({ stage: 'DENY', reason: 'not_authorized_to_manage_share', fieldName });
      return { isAuthorized: false };
    }

    // Unknown operation
    logAuth({ stage: 'DENY', reason: 'unknown_operation', fieldName });
    return { isAuthorized: false };

  } catch (err) {
    console.error('AUTHZ_ERROR', err);
    return { isAuthorized: false };
  }
};
