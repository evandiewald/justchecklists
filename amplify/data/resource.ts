import { type ClientSchema, a, defineData } from "@aws-amplify/backend";

const schema = a.schema({
  Checklist: a
    .model({
      title: a.string().required(),
      description: a.string(),
      isPublic: a.boolean().default(false),
      createdAt: a.datetime(),
      updatedAt: a.datetime(),
      author: a.string().required(), // User ID
      useCount: a.integer().default(0),
      lastUsedAt: a.datetime(),
      isPrivatelyShared: a.boolean().default(false),
      shareCount: a.integer().default(0),
      sections: a.hasMany('ChecklistSection', 'checklistId'),
      shares: a.hasMany('ChecklistShare', 'checklistId'),
    })
    .authorization((allow) => [
      allow.authenticated(),
      allow.publicApiKey().to(['read']),
    ]),

  ChecklistSection: a
    .model({
      title: a.string().required(),
      order: a.integer().required(),
      checklistId: a.id().required(),
      checklist: a.belongsTo('Checklist', 'checklistId'),
      items: a.hasMany('ChecklistItem', 'sectionId'),
    })
    .authorization((allow) => [
      allow.authenticated(),
      allow.publicApiKey().to(['read']),
    ]),

  ChecklistItem: a
    .model({
      title: a.string().required(),
      description: a.string(),
      order: a.integer().required(),
      completed: a.boolean().default(false),
      tags: a.string().array(),
      sectionId: a.id().required(),
      section: a.belongsTo('ChecklistSection', 'sectionId'),
    })
    .authorization((allow) => [
      allow.authenticated(),
      allow.publicApiKey().to(['read']),
    ]),

  ChecklistShare: a
    .model({
      checklistId: a.id().required(),
      checklist: a.belongsTo('Checklist', 'checklistId'),
      userId: a.string().required(), // cognito username
      email: a.string(), // user's email address for display
      role: a.enum(['OWNER', 'EDITOR', 'VIEWER']),
      shareToken: a.string(), // For link-based sharing
      sharedBy: a.string(), // cognito username
      createdAt: a.datetime(),
      expiresAt: a.datetime(), // Optional expiration
    })
    .identifier(['checklistId', 'userId'])
    .authorization((allow) => [
      allow.authenticated(),
    ]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "userPool",
    apiKeyAuthorizationMode: {
      expiresInDays: 30,
    },
  },
});

/*== STEP 2 ===============================================================
Go to your frontend source code. From your client-side code, generate a
Data client to make CRUDL requests to your table. (THIS SNIPPET WILL ONLY
WORK IN THE FRONTEND CODE FILE.)

Using JavaScript or Next.js React Server Components, Middleware, Server 
Actions or Pages Router? Review how to generate Data clients for those use
cases: https://docs.amplify.aws/gen2/build-a-backend/data/connect-to-API/
=========================================================================*/

/*
"use client"
import { generateClient } from "aws-amplify/data";
import type { Schema } from "@/amplify/data/resource";

const client = generateClient<Schema>() // use this Data client for CRUDL requests
*/

/*== STEP 3 ===============================================================
Fetch records from the database and use them in your frontend component.
(THIS SNIPPET WILL ONLY WORK IN THE FRONTEND CODE FILE.)
=========================================================================*/

/* For example, in a React component, you can use this snippet in your
  function's RETURN statement */
// const { data: todos } = await client.models.Todo.list()

// return <ul>{todos.map(todo => <li key={todo.id}>{todo.content}</li>)}</ul>
