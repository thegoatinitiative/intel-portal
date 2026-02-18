# Intel Portal — GitHub Pages Deployment

A static intelligence report portal built with vanilla HTML, CSS, and JavaScript. Designed for deployment on GitHub Pages with client-side authentication and a searchable report dashboard.

## Quick Start

### 1. Create a GitHub Repository

```bash
# Clone or create a new repo
git init intel-portal
cd intel-portal

# Copy all project files into this directory, then:
git add -A
git commit -m "Initial commit — Intel Portal"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/intel-portal.git
git push -u origin main
```

### 2. Enable GitHub Pages

1. Go to your repo on GitHub
2. Navigate to **Settings** → **Pages**
3. Under **Source**, select **Deploy from a branch**
4. Choose **main** branch and **/ (root)** folder
5. Click **Save**
6. Your site will be live at `https://YOUR_USERNAME.github.io/intel-portal/`

### 3. Log In

Default credentials:

| Username  | Password          |
|-----------|-------------------|
| `admin`   | `classified2024`  |
| `analyst` | `intel$ecure`     |

## Customizing Credentials

Credentials are stored as SHA-256 hashes of `username:password` in `js/auth.js`.

To generate a new hash:

```bash
# macOS / Linux
echo -n "myuser:mypassword" | shasum -a 256

# Or using Python
python3 -c "import hashlib; print(hashlib.sha256(b'myuser:mypassword').hexdigest())"
```

Then replace or add hashes in the `VALID_CREDENTIALS` array in `js/auth.js`.

## Adding Reports

Edit `js/reports.js` and add entries to the `REPORTS` array. Each report needs:

```javascript
{
  id: "RPT-YYYY-NNNN",           // Unique report ID
  passportNumber: "X1234567",     // Passport number
  subjectName: "Full Name",       // Subject's name
  nationality: "Country",         // Nationality
  date: "YYYY-MM-DD",            // Report date
  classification: "secret",       // "top-secret", "secret", or "confidential"
  summary: "Brief description",   // Shown in sidebar
  content: `# Markdown content..` // Full report in Markdown format
}
```

The `content` field supports full Markdown including tables, blockquotes, code blocks, lists, and emphasis.

## Project Structure

```
intel-portal/
├── index.html          # Login page
├── dashboard.html      # Main dashboard with report viewer
├── css/
│   └── style.css       # All styles
├── js/
│   ├── auth.js         # Authentication logic (hashed credentials)
│   ├── reports.js      # Report data (editable)
│   └── dashboard.js    # Dashboard UI logic
└── README.md           # This file
```

## Security Considerations

**This portal uses client-side authentication for demo purposes only.**

Anyone who inspects the page source can:
- View the credential hashes (and potentially brute-force them)
- Access `dashboard.html` directly by modifying JavaScript
- Read all report data from `reports.js`

### For production use with real sensitive data, you must:

1. **Use server-side authentication** — Firebase Auth, Auth0, Cloudflare Access, or a custom backend with session management
2. **Serve reports from an authenticated API** — not as static JS files
3. **Enable HTTPS** (GitHub Pages does this automatically)
4. **Implement audit logging** for all access
5. **Use proper access controls** with role-based permissions
6. **Encrypt data at rest** in your storage layer
7. **Consider Cloudflare Access or Netlify Identity** if you need to stay on static hosting but want real auth

## Technologies

- Vanilla HTML5, CSS3, JavaScript (ES6+)
- [Marked.js](https://marked.js.org/) — Markdown rendering
- [DOMPurify](https://github.com/cure53/DOMPurify) — HTML sanitization
- No build step required — deploy as-is

## Browser Support

Works in all modern browsers (Chrome, Firefox, Safari, Edge). Requires JavaScript enabled.

## License

MIT
