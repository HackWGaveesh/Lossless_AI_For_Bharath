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
      natGateways: 1,
      subnetConfiguration: [
        { name: 'Public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'Private', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
        { name: 'Isolated', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
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
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: 'index.html',
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

    const dbCluster = new rds.ServerlessCluster(this, 'VaaniSetuDB', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({ version: rds.AuroraPostgresEngineVersion.VER_15_4 }),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      scaling: {
        minCapacity: rds.AuroraCapacityUnit.ACU_2,
        maxCapacity: rds.AuroraCapacityUnit.ACU_4,
        autoPause: cdk.Duration.minutes(10),
      },
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
        BEDROCK_AGENT_ID: process.env.BEDROCK_AGENT_ID || '',
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
    const schemeSearchResource = schemesResource.addResource('search');
    schemeSearchResource.addMethod('POST', new apigateway.LambdaIntegration(schemeSearchFn));

    const documentsResource = api.root.addResource('documents');
    const documentUploadResource = documentsResource.addResource('upload');
    documentUploadResource.addMethod('POST', new apigateway.LambdaIntegration(documentUploadFn));

    const applicationsResource = api.root.addResource('applications');
    applicationsResource.addMethod('GET', new apigateway.LambdaIntegration(applicationListFn));
    applicationsResource.addMethod('POST', new apigateway.LambdaIntegration(applicationCreateFn));

    new sns.Topic(this, 'NotificationTopic', {
      topicName: 'vaanisetu-notifications',
      displayName: 'VaaniSetu User Notifications',
    });

    const distribution = new cloudfront.Distribution(this, 'VaaniSetuDistribution', {
      defaultBehavior: {
        origin: new origins.S3Origin(frontendBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
      ],
    });

    new cdk.CfnOutput(this, 'APIEndpoint', {
      value: api.url,
      description: 'API Gateway endpoint URL',
      exportName: 'VaaniSetuAPIUrl',
    });
    new cdk.CfnOutput(this, 'CloudFrontURL', {
      value: distribution.distributionDomainName,
      description: 'CloudFront distribution URL',
      exportName: 'VaaniSetuFrontendUrl',
    });
    new cdk.CfnOutput(this, 'DocumentsBucketName', {
      value: documentsBucket.bucketName,
      description: 'S3 bucket for document storage',
      exportName: 'VaaniSetuDocumentsBucket',
    });
    new cdk.CfnOutput(this, 'DatabaseClusterArn', {
      value: dbCluster.clusterArn,
      description: 'Aurora Serverless cluster ARN',
      exportName: 'VaaniSetuDBClusterArn',
    });
  }
}
