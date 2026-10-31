# 検証

ソースからの確認には、Node.js 24以降と.NET SDKを使用します。Windows向けのインストーラーと実機動作の確認は、Windows環境で実施します。

```sh
npm ci
npm run check:version
npm test
dotnet run --project tests/native/NativeChecks.csproj -c Release
npx playwright install chromium
npm run test:ui
npm run build
```

ビルド・署名・配布の手順は [docs/Releasing.md](docs/Releasing.md) を参照してください。
