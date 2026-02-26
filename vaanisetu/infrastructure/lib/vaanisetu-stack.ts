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
      serverlessV2MinCapacity: 0.5,
      serverlessV2MaxCapacity: 2,
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
      actions: ['bedrock:InvokeAgent', 'bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
      resources: ['*'],
    }));
    lambdaExecutionRole.addToPolicy(new iam.PolicyStatement({
      actions: ['textract:AnalyzeDocument', 'textract:DetectDocumentText'],
      resources: ['*'],
    }));
    usersTable.grantReadWriteData(lambdaExecutionRole);
    sessionsTable.grantReadWriteData(lambdaExecutionRole);
    applicationsTable.grantReadWriteData(lambdaExecutionRole);
    documentsTable.grantReadWriteData(lambdaExecutionRole);
    documentsBucket.grantReadWrite(lambdaExecutionRole);
    dbCluster.grantDataApiAccess(lambdaExecutionRole);

    const backendPath = path.join(__dirname, '../../backend/src');
    const nodeOptions = {
      runtime: lambda.Runtime.NODEJS_20_X,
      role: lambdaExecutionRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      tracing: lambda.Tracing.ACTIVE,
      environment: {
        USERS_TABLE: usersTable.tableName,
        APPLICATIONS_TABLE: applicationsTable.tableName,
        DB_CLUSTER_ARN: dbCluster.clusterArn,
        DB_SECRET_ARN: dbCluster.secret!.secretArn,
        DB_NAME: 'vaanisetu',
        REGION: this.region,
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
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
        metricsEnabled: true,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization', 'X-Api-Key'],
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
    });
    const voiceResource = api.root.addResource('voice').addResource('query');
    voiceResource.addMethod('POST', new apigateway.LambdaIntegration(voiceQueryFn));

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
      },
    });
    api.root.addResource('health').addMethod('GET', new apigateway.LambdaIntegration(healthFn));

    new sns.Topic(this, 'NotificationTopic', {
      topicName: 'vaanisetu-notifications',
      displayName: 'VaaniSetu User Notifications',
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
      applicationListFn,
      applicationCreateFn,
      voiceQueryFn,
      jobsListFn,
      jobsMatchFn,
      userProfileFn,
      healthFn,
    ];

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
  }
}
