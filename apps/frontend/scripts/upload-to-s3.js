import { execSync } from 'child_process';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';

const argv = yargs(hideBin(process.argv))
  .option('profile', {
    type: 'string',
    describe: 'AWS CLI profile to use',
    demandOption: false,
  })
  .option('bucket', {
    type: 'string',
    describe: 'S3 bucket name',
    demandOption: false,
  })
  .argv;

const profile = argv.profile ? `--profile ${argv.profile}` : '';
const bucket = argv.bucket || 'go-groceries-test';

const cmd = `aws s3 cp dist/ s3://${bucket}/ --recursive ${profile}`;
console.log(`Uploading with command: ${cmd}`);
execSync(cmd, { stdio: 'inherit' });