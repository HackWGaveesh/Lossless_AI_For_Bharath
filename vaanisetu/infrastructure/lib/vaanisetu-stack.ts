import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import path from 'path';

export class VaaniSetuStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const kmsKey = new kms.Key(this, 'VaaniSetuKMSKey', {
      description: 'VaaniSetu encryption key for data at rest',
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const vpc = new ec2.Vpc(this, 'VaaniSetuVPC', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: 'Public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'Isolated', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });
    vpc.addGatewayEndpoint('S3GatewayEndpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
    });
    vpc.addGatewayEndpoint('DynamoDBGatewayEndpoint', {
      service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
    });

    const documentsBucket = new s3.Bucket(this, 'VaaniSetuDocuments', {
      bucketName: `vaanisetu-documents-${this.account}`,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: kmsKey,
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(90),
          transitions: [{ storageClass: s3.StorageClass.INTELLIGENT_TIERING, transitionAfter: cdk.Duration.days(30) }],
        },
      ],
      cors: [
        {
          allowedOrigins: ['*'],
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET, s3.HttpMethods.HEAD],
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag'],
          maxAge: 3000,
        },
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const frontendBucket = new s3.Bucket(this, 'VaaniSetuFrontend', {
      bucketName: `vaanisetu-frontend-${this.account}`,
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const usersTable = new dynamodb.Table(this, 'UsersTable', {
      tableName: 'vaanisetu-users',
      partitionKey: { name: 'user_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: kmsKey,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    usersTable.addGlobalSecondaryIndex({
      indexName: 'phone-index',
      partitionKey: { name: 'phone_number', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    const sessionsTable = new dynamodb.Table(this, 'SessionsTable', {
      tableName: 'vaanisetu-sessions',
      partitionKey: { name: 'session_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: kmsKey,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const applicationsTable = new dynamodb.Table(this, 'ApplicationsTable', {
      tableName: 'vaanisetu-applications',
      partitionKey: { name: 'user_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'application_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: kmsKey,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const documentsTable = new dynamodb.Table(this, 'DocumentsTable', {
      tableName: 'vaanisetu-documents',
      partitionKey: { name: 'user_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'document_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: kmsKey,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Aurora Serverless v2 (v1 engine mode is unavailable in many regions/accounts)
    const dbCluster = new rds.DatabaseCluster(this, 'VaaniSetuDB', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.of('16.8', '16'),
      }),
      credentials: rds.Credentials.fromGeneratedSecret('postgres'),
      writer: rds.ClusterInstance.serverlessV2('writer'),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      serverlessV2MinCapacity: 0,
      serverlessV2MaxCapacity: 2,
      serverlessV2AutoPauseDuration: cdk.Duration.minutes(15),
      enableDataApi: true,
      defaultDatabaseName: 'vaanisetu',
      storageEncryptionKey: kmsKey,
      removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
    });

    const lambdaExecutionRole = new iam.Role(this, 'LambdaExecutionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });
    lambdaExecutionRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'bedrock:InvokeAgent',
        'bedrock:InvokeModel',
        'bedrock:InvokeModelWithResponseStream',
        'bedrock:Retrieve',
        'bedrock:ApplyGuardrail',
      ],
      resources: ['*'],
    }));
    lambdaExecutionRole.addToPolicy(new iam.PolicyStatement({
      actions: ['sns:Publish'],
      resources: ['*'],
    }));
    lambdaExecutionRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'textract:AnalyzeDocument',
        'textract:DetectDocumentText',
        'textract:StartDocumentTextDetection',
        'textract:GetDocumentTextDetection',
      ],
      resources: ['*'],
    }));
    lambdaExecutionRole.addToPolicy(new iam.PolicyStatement({
      actions: ['transcribe:StartTranscriptionJob', 'transcribe:GetTranscriptionJob'],
      resources: ['*'],
    }));
    usersTable.grantReadWriteData(lambdaExecutionRole);
    sessionsTable.grantReadWriteData(lambdaExecutionRole);
    applicationsTable.grantReadWriteData(lambdaExecutionRole);
    documentsTable.grantReadWriteData(lambdaExecutionRole);
    documentsBucket.grantReadWrite(lambdaExecutionRole);
    dbCluster.grantDataApiAccess(lambdaExecutionRole);

    // Knowledge Base S3 bucket for Bedrock RAG
    const kbBucket = new s3.Bucket(this, 'VaaniSetuKBBucket', {
      bucketName: `vaanisetu-kb-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: kmsKey,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
    kbBucket.grantReadWrite(lambdaExecutionRole);
    new cdk.CfnOutput(this, 'KnowledgeBaseBucketName', {
      value: kbBucket.bucketName,
      description: 'S3 bucket for Bedrock Knowledge Base',
    });

    // IAM role for Bedrock Agent to call Lambda and access KB
    const bedrockAgentRole = new iam.Role(this, 'BedrockAgentRole', {
      roleName: `vaanisetu-bedrock-agent-${this.account}`,
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
      inlinePolicies: {
        BedrockAgentPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
              resources: ['*'],
            }),
            new iam.PolicyStatement({
              actions: ['s3:GetObject', 's3:ListBucket'],
              resources: [kbBucket.bucketArn, `${kbBucket.bucketArn}/*`],
            }),
            new iam.PolicyStatement({
              actions: ['bedrock:Retrieve', 'bedrock:RetrieveAndGenerate'],
              resources: ['*'],
            }),
            new iam.PolicyStatement({
              actions: ['lambda:InvokeFunction'],
              resources: ['*'],
            }),
            new iam.PolicyStatement({
              actions: ['aoss:APIAccessAll'],
              resources: ['*'],
            }),
          ],
        }),
      },
    });
    new cdk.CfnOutput(this, 'BedrockAgentRoleArn', {
      value: bedrockAgentRole.roleArn,
      description: 'IAM role for Bedrock Agent',
    });

    // SNS Topic for notifications (moved here so custom auth Lambda can reference it)
    const notificationTopic = new sns.Topic(this, 'NotificationTopic', {
      topicName: 'vaanisetu-notifications',
      displayName: 'VaaniSetu User Notifications',
    });

    // Custom Auth Lambda — Define Auth Challenge
    const defineAuthChallengeFn = new lambda.Function(this, 'DefineAuthChallenge', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      timeout: cdk.Duration.seconds(10),
      logRetention: logs.RetentionDays.ONE_WEEK,
      code: lambda.Code.fromInline(`
exports.handler = async (event) => {
  const session = event.request.session || [];
  if (session.length >= 3) {
    event.response.issueTokens = false;
    event.response.failAuthentication = true;
  } else if (
    session.length > 0 &&
    session[session.length - 1].challengeName === 'CUSTOM_CHALLENGE' &&
    session[session.length - 1].challengeResult === true
  ) {
    event.response.issueTokens = true;
    event.response.failAuthentication = false;
  } else {
    event.response.issueTokens = false;
    event.response.failAuthentication = false;
    event.response.challengeName = 'CUSTOM_CHALLENGE';
  }
  return event;
};`),
    });

    // Custom Auth Lambda — Create Auth Challenge (sends OTP via SNS SMS)
    const createAuthChallengeFn = new lambda.Function(this, 'CreateAuthChallenge', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      timeout: cdk.Duration.seconds(15),
      logRetention: logs.RetentionDays.ONE_WEEK,
      environment: {
        TEST_OTP_ENABLED: 'true',
        TEST_OTP_CODE: '112233',
        TEST_OTP_PHONES: process.env.TEST_OTP_PHONES || '+918431672149,+919878543210',
      },
      code: lambda.Code.fromInline(`
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const snsClient = new SNSClient({ region: process.env.AWS_REGION || 'ap-south-1' });

exports.handler = async (event) => {
  const session = event.request.session || [];
  const phone = event.request.userAttributes?.phone_number;
  const testOtpEnabled = process.env.TEST_OTP_ENABLED === 'true';
  const testOtpCode = (process.env.TEST_OTP_CODE || '112233').replace(/\\D/g, '').slice(0, 6) || '112233';
  const testOtpPhones = (process.env.TEST_OTP_PHONES || '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const isTestOtpPhone = !!phone && testOtpPhones.includes(phone);
  
  console.log('phone=', phone);
  
  if (!phone) {
    throw new Error('No phone_number in userAttributes');
  }

  let code;
  if (!session.length) {
    if (testOtpEnabled && isTestOtpPhone) {
      code = testOtpCode;
      console.log('Using test OTP fallback for whitelisted phone');
    } else {
      code = Math.floor(100000 + Math.random() * 900000).toString();
      await snsClient.send(new PublishCommand({
        PhoneNumber: phone,
        Message: 'Your VaaniSetu OTP is: ' + code + '. Valid for 5 minutes.',
      }));
      console.log('SMS sent');
    }
  } else {
    code = session[session.length - 1].challengeMetadata.replace('CODE-', '');
  }

  event.response.publicChallengeParameters = {
    phone,
    delivery: testOtpEnabled && isTestOtpPhone ? 'test' : 'sms',
  };
  event.response.privateChallengeParameters = { answer: code };
  event.response.challengeMetadata = 'CODE-' + code;
  return event;
};`),
    });
    createAuthChallengeFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['sns:Publish'],
      resources: ['*'],
    }));

    // Custom Auth Lambda — Verify Auth Challenge Response
    const verifyAuthChallengeResponseFn = new lambda.Function(this, 'VerifyAuthChallengeResponse', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      timeout: cdk.Duration.seconds(10),
      logRetention: logs.RetentionDays.ONE_WEEK,
      code: lambda.Code.fromInline(`
exports.handler = async (event) => {
  event.response.answerCorrect =
    event.request.privateChallengeParameters.answer === event.request.challengeAnswer;
  return event;
};`),
    });

    // Pre Sign-up: auto-confirm and auto-verify phone so new users can use custom auth OTP immediately
    const preSignUpFn = new lambda.Function(this, 'PreSignUp', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      timeout: cdk.Duration.seconds(5),
      logRetention: logs.RetentionDays.ONE_WEEK,
      code: lambda.Code.fromInline(`
exports.handler = async (event) => {
  event.response.autoConfirmUser = true;
  event.response.autoVerifyPhone = true;
  return event;
};`),
    });

    const backendPath = path.join(__dirname, '../../backend/src');
    const budgetMode = String(process.env.BUDGET_MODE || 'normal').toLowerCase();
    const nodeOptions = {
      runtime: lambda.Runtime.NODEJS_20_X,
      role: lambdaExecutionRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_WEEK,
      environment: {
        USERS_TABLE: usersTable.tableName,
        APPLICATIONS_TABLE: applicationsTable.tableName,
        DB_CLUSTER_ARN: dbCluster.clusterArn,
        DB_SECRET_ARN: dbCluster.secret!.secretArn,
        DB_NAME: 'vaanisetu',
        REGION: this.region,
        NOTIFICATION_TOPIC_ARN: notificationTopic.topicArn,
        BUDGET_MODE: budgetMode,
      },
    };

    const schemeListFn = new lambdaNode.NodejsFunction(this, 'SchemeListFunction', {
      ...nodeOptions,
      entry: path.join(backendPath, 'api/schemes/list.ts'),
      handler: 'handler',
      environment: {
        ...nodeOptions.environment,
        DB_CLUSTER_ARN: dbCluster.clusterArn,
        DB_SECRET_ARN: dbCluster.secret!.secretArn,
      },
    });

    const schemeDetailFn = new lambdaNode.NodejsFunction(this, 'SchemeDetailFunction', {
      ...nodeOptions,
      entry: path.join(backendPath, 'api/schemes/detail.ts'),
      handler: 'handler',
      environment: {
        ...nodeOptions.environment,
        DB_CLUSTER_ARN: dbCluster.clusterArn,
        DB_SECRET_ARN: dbCluster.secret!.secretArn,
      },
    });

    const schemeSearchFn = new lambdaNode.NodejsFunction(this, 'SchemeSearchFunction', {
      ...nodeOptions,
      entry: path.join(backendPath, 'api/schemes/search.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(60),
      memorySize: 1024,
      environment: {
        ...nodeOptions.environment,
        BEDROCK_AGENT_ID: process.env.BEDROCK_AGENT_ID || '',
        BEDROCK_AGENT_ALIAS_ID: process.env.BEDROCK_AGENT_ALIAS_ID || 'TSTALIASID',
        DB_CLUSTER_ARN: dbCluster.clusterArn,
        DB_SECRET_ARN: dbCluster.secret!.secretArn,
      },
    });

    const documentUploadFn = new lambdaNode.NodejsFunction(this, 'DocumentUploadFunction', {
      ...nodeOptions,
      entry: path.join(backendPath, 'api/documents/upload.ts'),
      handler: 'handler',
      environment: {
        ...nodeOptions.environment,
        DOCUMENTS_BUCKET: documentsBucket.bucketName,
        DOCUMENTS_TABLE: documentsTable.tableName,
      },
    });

    const documentProcessFn = new lambdaNode.NodejsFunction(this, 'DocumentProcessFunction', {
      ...nodeOptions,
      entry: path.join(backendPath, 'api/documents/process.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(60),
      memorySize: 2048,
      environment: {
        ...nodeOptions.environment,
        DOCUMENTS_BUCKET: documentsBucket.bucketName,
        DOCUMENTS_TABLE: documentsTable.tableName,
        BEDROCK_AGENT_ID: process.env.BEDROCK_AGENT_ID || '',
      },
    });

    const documentStatusFn = new lambdaNode.NodejsFunction(this, 'DocumentStatusFunction', {
      ...nodeOptions,
      entry: path.join(backendPath, 'api/documents/status.ts'),
      handler: 'handler',
      environment: {
        ...nodeOptions.environment,
        DOCUMENTS_TABLE: documentsTable.tableName,
      },
    });
    const documentListFn = new lambdaNode.NodejsFunction(this, 'DocumentListFunction', {
      ...nodeOptions,
      entry: path.join(backendPath, 'api/documents/list.ts'),
      handler: 'handler',
      environment: {
        ...nodeOptions.environment,
        DOCUMENTS_TABLE: documentsTable.tableName,
      },
    });

    documentsBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(documentProcessFn)
    );

    const applicationListFn = new lambdaNode.NodejsFunction(this, 'ApplicationListFunction', {
      ...nodeOptions,
      entry: path.join(backendPath, 'api/applications/list.ts'),
      handler: 'handler',
      environment: {
        ...nodeOptions.environment,
        APPLICATIONS_TABLE: applicationsTable.tableName,
      },
    });

    const applicationCreateFn = new lambdaNode.NodejsFunction(this, 'ApplicationCreateFunction', {
      ...nodeOptions,
      entry: path.join(backendPath, 'api/applications/create.ts'),
      handler: 'handler',
      environment: {
        ...nodeOptions.environment,
        APPLICATIONS_TABLE: applicationsTable.tableName,
        DB_CLUSTER_ARN: dbCluster.clusterArn,
        DB_SECRET_ARN: dbCluster.secret!.secretArn,
      },
    });

    const api = new apigateway.RestApi(this, 'VaaniSetuAPI', {
      restApiName: 'VaaniSetu API',
      description: 'API Gateway for VaaniSetu backend',
      deployOptions: {
        stageName: 'prod',
        tracingEnabled: true,
        loggingLevel: apigateway.MethodLoggingLevel.ERROR,
        dataTraceEnabled: false,
        metricsEnabled: true,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization', 'X-Api-Key', 'X-User-Id'],
      },
    });

    const schemesResource = api.root.addResource('schemes');
    schemesResource.addMethod('GET', new apigateway.LambdaIntegration(schemeListFn));
    const schemeIdResource = schemesResource.addResource('{schemeId}');
    schemeIdResource.addMethod('GET', new apigateway.LambdaIntegration(schemeDetailFn));
    const schemeSearchResource = schemesResource.addResource('search');
    schemeSearchResource.addMethod('POST', new apigateway.LambdaIntegration(schemeSearchFn));

    const documentsResource = api.root.addResource('documents');
    const documentUploadResource = documentsResource.addResource('upload');
    documentUploadResource.addMethod('POST', new apigateway.LambdaIntegration(documentUploadFn));
    documentsResource.addMethod('GET', new apigateway.LambdaIntegration(documentListFn));

    const applicationsResource = api.root.addResource('applications');
    applicationsResource.addMethod('GET', new apigateway.LambdaIntegration(applicationListFn));
    applicationsResource.addMethod('POST', new apigateway.LambdaIntegration(applicationCreateFn));

    const documentIdResource = documentsResource.addResource('{id}').addResource('status');
    documentIdResource.addMethod('GET', new apigateway.LambdaIntegration(documentStatusFn));

    const voiceQueryFn = new lambdaNode.NodejsFunction(this, 'VoiceQueryFunction', {
      ...nodeOptions,
      entry: path.join(backendPath, 'api/voice/query.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        ...nodeOptions.environment,
        BEDROCK_AGENT_ID: process.env.BEDROCK_AGENT_ID || '',
        BEDROCK_AGENT_ALIAS_ID: process.env.BEDROCK_AGENT_ALIAS_ID || 'TSTALIASID',
        BEDROCK_GUARDRAIL_ID: process.env.BEDROCK_GUARDRAIL_ID || '',
      },
    });
    const voiceTranscribeFn = new lambdaNode.NodejsFunction(this, 'VoiceTranscribeFunction', {
      ...nodeOptions,
      entry: path.join(backendPath, 'api/voice/transcribe.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(90),
      memorySize: 1024,
      environment: {
        ...nodeOptions.environment,
        DOCUMENTS_BUCKET: documentsBucket.bucketName,
      },
    });
    const voiceBaseResource = api.root.addResource('voice');
    const voiceResource = voiceBaseResource.addResource('query');
    voiceResource.addMethod('POST', new apigateway.LambdaIntegration(voiceQueryFn));
    voiceBaseResource.addResource('transcribe').addMethod('POST', new apigateway.LambdaIntegration(voiceTranscribeFn));

    const jobsListFn = new lambdaNode.NodejsFunction(this, 'JobsListFunction', {
      ...nodeOptions,
      entry: path.join(backendPath, 'api/jobs/list.ts'),
      handler: 'handler',
      environment: {
        ...nodeOptions.environment,
        DB_CLUSTER_ARN: dbCluster.clusterArn,
        DB_SECRET_ARN: dbCluster.secret!.secretArn,
      },
    });
    const jobsMatchFn = new lambdaNode.NodejsFunction(this, 'JobsMatchFunction', {
      ...nodeOptions,
      entry: path.join(backendPath, 'api/jobs/match.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(60),
      memorySize: 1024,
      environment: {
        ...nodeOptions.environment,
        DB_CLUSTER_ARN: dbCluster.clusterArn,
        DB_SECRET_ARN: dbCluster.secret!.secretArn,
      },
    });
    const jobsResource = api.root.addResource('jobs');
    jobsResource.addMethod('GET', new apigateway.LambdaIntegration(jobsListFn));
    jobsResource.addResource('match').addMethod('POST', new apigateway.LambdaIntegration(jobsMatchFn));

    const userProfileFn = new lambdaNode.NodejsFunction(this, 'UserProfileFunction', {
      ...nodeOptions,
      entry: path.join(backendPath, 'api/user/profile.ts'),
      handler: 'handler',
      environment: {
        ...nodeOptions.environment,
        USERS_TABLE: usersTable.tableName,
      },
    });
    const userResource = api.root.addResource('user').addResource('profile');
    userResource.addMethod('GET', new apigateway.LambdaIntegration(userProfileFn));
    userResource.addMethod('PUT', new apigateway.LambdaIntegration(userProfileFn));

    const healthFn = new lambdaNode.NodejsFunction(this, 'HealthFunction', {
      ...nodeOptions,
      entry: path.join(backendPath, 'api/health.ts'),
      handler: 'handler',
      environment: {
        ...nodeOptions.environment,
        DB_CLUSTER_ARN: dbCluster.clusterArn,
        DB_SECRET_ARN: dbCluster.secret!.secretArn,
        BEDROCK_AGENT_ID: process.env.BEDROCK_AGENT_ID || '',
        BEDROCK_AGENT_ALIAS_ID: process.env.BEDROCK_AGENT_ALIAS_ID || 'TSTALIASID',
        BEDROCK_GUARDRAIL_ID: process.env.BEDROCK_GUARDRAIL_ID || '',
      },
    });
    api.root.addResource('health').addMethod('GET', new apigateway.LambdaIntegration(healthFn));

    notificationTopic.grantPublish(lambdaExecutionRole);
    notificationTopic.addToResourcePolicy(new iam.PolicyStatement({
      principals: [new iam.ServicePrincipal('budgets.amazonaws.com')],
      actions: ['SNS:Publish'],
      resources: [notificationTopic.topicArn],
    }));

    new budgets.CfnBudget(this, 'VaaniSetuMonthlyBudget', {
      budget: {
        budgetName: `VaaniSetu-Monthly-${this.account}`,
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: {
          amount: 50,
          unit: 'USD',
        },
      },
      notificationsWithSubscribers: [35, 45, 50].map((threshold) => ({
        notification: {
          comparisonOperator: 'GREATER_THAN',
          notificationType: 'FORECASTED',
          threshold,
          thresholdType: 'PERCENTAGE',
        },
        subscribers: [
          {
            subscriptionType: 'SNS',
            address: notificationTopic.topicArn,
          },
        ],
      })),
    });

    const userPool = new cognito.UserPool(this, 'VaaniSetuUserPool', {
      userPoolName: 'vaanisetu-users',
      selfSignUpEnabled: true,
      signInAliases: { phone: true },
      autoVerify: { phone: true },
      standardAttributes: {
        phoneNumber: { required: true, mutable: true },
        fullname: { required: false, mutable: true },
      },
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { sms: true, otp: false },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: false,
        requireUppercase: false,
        requireDigits: false,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.PHONE_ONLY_WITHOUT_MFA,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      lambdaTriggers: {
        preSignUp: preSignUpFn,
        defineAuthChallenge: defineAuthChallengeFn,
        createAuthChallenge: createAuthChallengeFn,
        verifyAuthChallengeResponse: verifyAuthChallengeResponseFn,
      },
    });

    const userPoolClient = userPool.addClient('VaaniSetuUserPoolClient', {
      authFlows: {
        userSrp: true,
        userPassword: true,
        custom: true,
      },
      generateSecret: false,
      preventUserExistenceErrors: true,
    });

    const dashboard = new cloudwatch.Dashboard(this, 'VaaniSetuDashboard', {
      dashboardName: 'VaaniSetu-Operations',
    });

    const allFunctions = [
      schemeListFn,
      schemeDetailFn,
      schemeSearchFn,
      documentUploadFn,
      documentProcessFn,
      documentStatusFn,
      documentListFn,
      applicationListFn,
      applicationCreateFn,
      voiceQueryFn,
      voiceTranscribeFn,
      jobsListFn,
      jobsMatchFn,
      userProfileFn,
      healthFn,
    ];

    // Agent Action Group Lambda — invoked by Bedrock Agent for real data actions
    const agentActionFn = new lambdaNode.NodejsFunction(this, 'AgentActionFunction', {
      functionName: 'vaanisetu-agent-action',
      entry: path.join(backendPath, 'api/agent/action-handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      role: lambdaExecutionRole,
      timeout: cdk.Duration.seconds(60),
      memorySize: 512,
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_WEEK,
      // No VPC — allows fast cold starts and outbound to DynamoDB/SNS without VPC endpoints
      environment: {
        ...nodeOptions.environment,
        DOCUMENTS_TABLE: documentsTable.tableName,
      },
      bundling: { externalModules: ['@aws-sdk/*'], minify: true },
    });

    // Allow Bedrock service to invoke the Action Lambda
    agentActionFn.addPermission('BedrockAgentInvoke', {
      principal: new iam.ServicePrincipal('bedrock.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceArn: `arn:aws:bedrock:${this.region}:${this.account}:agent/*`,
    });

    new cdk.CfnOutput(this, 'AgentActionLambdaArn', {
      value: agentActionFn.functionArn,
      description: 'Lambda ARN for Bedrock Agent Action Group',
    });

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Lambda Invocations',
        left: allFunctions.map((fn) => fn.metricInvocations()),
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'Lambda Errors',
        left: allFunctions.map((fn) => fn.metricErrors()),
        width: 12,
      })
    );

    new cloudwatch.Alarm(this, 'LambdaErrorAlarm', {
      metric: schemeListFn.metricErrors(),
      threshold: 5,
      evaluationPeriods: 2,
      alarmName: 'VaaniSetu-Lambda-Errors',
    });

    const distribution = new cloudfront.Distribution(this, 'VaaniSetuDistribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(frontendBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
      ],
    });

    new cdk.CfnOutput(this, 'APIEndpoint', {
      value: api.url,
      description: 'API Gateway endpoint URL',
      exportName: 'VaaniSetuAPIUrl',
    });
    new cdk.CfnOutput(this, 'CloudFrontURL', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'CloudFront distribution URL',
      exportName: 'VaaniSetuFrontendUrl',
    });
    new cdk.CfnOutput(this, 'CloudFrontDistributionId', {
      value: distribution.distributionId,
      description: 'CloudFront distribution ID for cache invalidation',
      exportName: 'VaaniSetuCloudFrontDistributionId',
    });
    new cdk.CfnOutput(this, 'FrontendBucketName', {
      value: frontendBucket.bucketName,
      description: 'S3 bucket for frontend static assets',
      exportName: 'VaaniSetuFrontendBucket',
    });
    new cdk.CfnOutput(this, 'DocumentsBucketName', {
      value: documentsBucket.bucketName,
      description: 'S3 bucket for document storage',
      exportName: 'VaaniSetuDocumentsBucket',
    });
    new cdk.CfnOutput(this, 'DatabaseClusterArn', {
      value: dbCluster.clusterArn,
      description: 'Aurora Serverless v2 cluster ARN',
      exportName: 'VaaniSetuDBClusterArn',
    });
    if (dbCluster.secret) {
      new cdk.CfnOutput(this, 'DatabaseSecretArn', {
        value: dbCluster.secret.secretArn,
        description: 'Secrets Manager secret ARN for DB credentials',
        exportName: 'VaaniSetuDBSecretArn',
      });
    }
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: userPool.userPoolId,
      description: 'Cognito User Pool ID',
      exportName: 'VaaniSetuUserPoolId',
    });
    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
      exportName: 'VaaniSetuUserPoolClientId',
    });
    new cdk.CfnOutput(this, 'NotificationTopicArn', {
      value: notificationTopic.topicArn,
      description: 'SNS Topic ARN for user notifications',
      exportName: 'VaaniSetuNotificationTopicArn',
    });
  }
}
