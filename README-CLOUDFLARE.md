Deploying to Cloudflare using Wrangler

This project serves static UI files from `public/`. You can deploy them to Cloudflare using Wrangler.

Prerequisites
- Node.js + npm installed
- Cloudflare account
- An API token with `Account.Workers Scripts:Edit` and `Account.Workers KV:Edit` (or use your global API key)
- Your Cloudflare `account_id` (find in the dashboard)

Quick deploy (recommended)
1. Install Wrangler (no global install required):

```bash
npm install -g wrangler
# or use npx below without installing globally
```

2. Update `wrangler.toml` with your `account_id` (and optionally change `name`).

3. Authenticate wrangler (pick one):

```bash
npx wrangler login
# or
export CLOUDFLARE_API_TOKEN="..."
```

4. Deploy the `public/` folder as a Workers Site using `npx wrangler deploy` (this command is configured in `package.json`):

```bash
npx wrangler deploy --site ./public
# or via npm script
npm run deploy
```

Notes
- Pages vs Workers: Cloudflare Pages is a separate product. Wrangler can publish to Pages with `wrangler pages publish ./public --project-name=<name>` depending on your wrangler version. The `wrangler deploy --site` above uses Workers Sites which is fine for small static sites.
- Web Serial: Browsers require HTTPS for Web Serial. Cloudflare will serve your site over HTTPS automatically.
- If you prefer Pages, replace the deploy command with `npx wrangler pages publish ./public --project-name=<your-project>`.

Troubleshooting
- If `npx wrangler deploy` errors about missing `account_id`, edit `wrangler.toml` and set the `account_id` value.
- If you see permission errors, ensure your API token has the appropriate scopes.

Want me to run the deploy command now? I can run `npx wrangler deploy --site ./public` if you authorize, but I will not push any secrets — you must provide `account_id` and approve the browser-based auth step when required.
