import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as fs from 'fs';
import * as path from 'path';

export class RdcStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // VPCの作成
    const vpc = new ec2.Vpc(this, 'RdcVpc', {
      maxAzs: 2, // デフォルトはすべてのAZを使用
    });

    // キーペアの作成
    const key = new ec2.KeyPair(this, 'RdcKeyPair', {
      keyPairName: 'rdc-key-pair'
    });

    // セキュリティグループの作成
    const securityGroup = new ec2.SecurityGroup(this, 'RdcSecurityGroup', {
      vpc,
      description: 'Allow SSH access',
      allowAllOutbound: true
    });

    // SSHアクセスを許可
    securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(22), 'Allow SSH access');

    // S3バケットの作成
    const bucket = new s3.Bucket(this, 'RdcBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY, // スタック削除時にバケットを削除
      autoDeleteObjects: true, // スタック削除時にバケット内のオブジェクトを削除
    });

    // ローカルの ec2-resources フォルダの内容をS3バケットにアップロード
    new s3deploy.BucketDeployment(this, 'DeployResources', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../ec2-resources'))],
      destinationBucket: bucket,
    });

    // Dockerインストールスクリプトの読み込み
    const dockerScript = fs.readFileSync(path.join(__dirname, '../install-docker.sh'), 'utf8');

    // EC2インスタンスの作成
    const instance = new ec2.Instance(this, 'RdcInstance', {
      vpc,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T2, ec2.InstanceSize.SMALL),
      machineImage: ec2.MachineImage.genericLinux({
        'ap-northeast-1': 'ami-0cab37bd176bb80d3' // Ubuntu 24.04 LTSのAMI ID（リージョンに応じて変更してください）
      }),
      keyPair: key, // キーペアを関連付け
      securityGroup, // セキュリティグループを関連付け
      role: new iam.Role(this, 'InstanceRole', {
        assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2FullAccess'),
          iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
          iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonS3ReadOnlyAccess')
        ]
      }),
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      }
    });

    // ユーザーデータスクリプトを追加してDockerをインストールし、リソースをコピー
    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      dockerScript,
      'mkdir -p /home/ubuntu/ec2-resources',
      `aws s3 cp s3://${bucket.bucketName}/ /home/ubuntu/ec2-resources --recursive`
    );
    instance.addUserData(userData.render());

    // キーペアをダウンロードするためのコマンドを出力
    new cdk.CfnOutput(this, 'DownloadKeyCommand', {
      value: `aws ssm get-parameter --name /ec2/keypair/${key.keyPairId} --with-decryption --query Parameter.Value --output text > ${key.keyPairId}.pem && chmod 400 ${key.keyPairId}.pem`,
    });

    // インスタンスに接続するためのSSHコマンドを出力
    new cdk.CfnOutput(this, 'SSHCommand', {
      value: `ssh -i ${key.keyPairId}.pem ubuntu@${instance.instancePublicDnsName}`,
    });

    // EC2インスタンスを停止するためのコマンドを出力
    new cdk.CfnOutput(this, 'StopInstanceCommand', {
      value: `aws ec2 stop-instances --instance-ids ${instance.instanceId}`,
    });

    // EC2インスタンスを開始するためのコマンドを出力
    new cdk.CfnOutput(this, 'StartInstanceCommand', {
      value: `aws ec2 start-instances --instance-ids ${instance.instanceId}`,
    });
  }
}
