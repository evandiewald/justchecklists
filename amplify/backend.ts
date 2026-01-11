import { defineBackend, secret } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data, authorizerFunction } from './data/resource';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';

const backend = defineBackend({
  auth,
  data,
  authorizerFunction,
});

// Access the authorizer Lambda function
const lambdaFunction = backend.authorizerFunction.resources.lambda as lambda.Function;

// Grant Lambda permissions for DynamoDB operations and table discovery
lambdaFunction.addToRolePolicy(new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  resources: ['*'], // Need wildcard for ListTables and DescribeTable
  actions: [
    'dynamodb:GetItem',
    'dynamodb:ListTables',
    'dynamodb:DescribeTable',
    'dynamodb:ListTagsOfResource',
  ],
}));

// Pass branch name for table discovery (doesn't create circular dependency)
lambdaFunction.addEnvironment('AMPLIFY_BRANCH', process.env.AWS_BRANCH || 'sandbox');

const cfnDomain = backend.auth.resources.userPool

// don't add a custom domain for sandbox
if (process.env.AWS_BRANCH === 'main') {
  cfnDomain.addDomain('customDomain', {
  customDomain: {
    domainName: 'auth.justchecklists.io',
    certificate: Certificate.fromCertificateArn(cfnDomain, 'certificate', process.env.CERTIFICATE_ARN!)
  }
});
}
