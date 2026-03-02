#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { VaaniSetuStack } from '../lib/vaanisetu-stack';

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env') });

const app = new cdk.App();

new VaaniSetuStack(app, 'VaaniSetuStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'ap-south-1',
  },
  description: 'VaaniSetu - Voice-First AI Platform for Rural India',
  tags: {
    Project: 'VaaniSetu',
    Environment: 'Production',
    ManagedBy: 'CDK',
  },
});

app.synth();
