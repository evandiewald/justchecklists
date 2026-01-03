import { defineBackend, secret } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';

const backend = defineBackend({
  auth,
  data,
});

const cfnDomain = backend.auth.resources.userPool

cfnDomain.addDomain('customDomain', {
  customDomain: {
    domainName: 'auth.justchecklists.io',
    certificate: Certificate.fromCertificateArn(
      cfnDomain, 'certificate',
      'arn:aws:acm:us-east-1:668146110194:certificate/c2d8a762-a484-4059-843d-bc5d8400c7d1'
    )
  }
});
