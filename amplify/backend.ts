import { defineBackend, secret } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';

const backend = defineBackend({
  auth,
  data,
});

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
