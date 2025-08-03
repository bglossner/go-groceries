# Getting the webiste

## Upload to S3 Bucket

Get AWS credentials:
- Install AWS CLI
- Set up AWS IAM Identity Center stuff with user and add AWS account
- `aws configure sso`
- `aws sso login --profile beng`
- `aws s3 ls --profile beng`
- `npm run build:pwa`
- `npm run upload-assets-to-s3 -- --profile beng`

## Temporary URL

Run command to create temporary URL linking to assets of preview/dist server:
```
npx cloudflared tunnel --url http://localhost:5174
```

Generate QR code:
```
python3 -c "import sys; import qrcode_terminal; qrcode_terminal.draw(sys.stdin.read().strip())" <<< <URL_GENERATED>
```

Use phone to go to URL and install app.