// Build : assemble index.html + src/* en une page unique et prépare le dossier publié par GitHub Pages (docs/).
// Usage : node build.js
const fs = require('fs');
const path = require('path');

const root = __dirname;
const read = f => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');
const between = (html, tag, replacement) => {
  const a = '<!-- build:' + tag + ' -->', b = '<!-- /build:' + tag + ' -->';
  const i = html.indexOf(a), j = html.indexOf(b);
  if (i < 0 || j < 0) throw new Error('bloc ' + tag + ' introuvable');
  return html.slice(0, i) + replacement + html.slice(j + b.length);
};

// Projet Supabase « harmonies » (clé publique anon : sans danger côté client, l'accès est régi par les policies RLS)
const SUPABASE_URL = 'https://jeqdtpuoufapovxvwtwa.supabase.co';
const SUPABASE_KEY = 'sb_publishable_kTn0yH1LO-vQ7cpjMx8-hQ_ydhfxLDx';
const BUILD_ID = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);

let html = read('index.html');
html = between(html, 'css', '<style>\n' + read('src/styles.css') + '\n</style>');
html = between(html, 'config', '<script>window.HARMONIES_CONFIG = { url: "' + SUPABASE_URL + '", key: "' + SUPABASE_KEY + '", build: "' + BUILD_ID + '" };</script>');
const js = ['src/cards.js', 'src/animals.js', 'src/icons.js', 'src/engine.js', 'src/bot.js', 'src/render.js', 'src/net.js', 'src/app.js'].map(f => '<script>\n' + read(f) + '\n</script>').join('\n');
html = between(html, 'js', js);
html = html.replace('<title>Harmonies</title>', '<title>Harmonies</title>\n<link rel="manifest" href="manifest.webmanifest">\n<link rel="apple-touch-icon" href="apple-touch-icon.png">\n<link rel="icon" type="image/svg+xml" href="icon.svg">\n<link rel="icon" type="image/png" sizes="192x192" href="icon-192.png">');

const out = path.join(root, 'docs');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'index.html'), html);
fs.writeFileSync(path.join(out, '.nojekyll'), '');
fs.writeFileSync(path.join(out, 'sw.js'), read('sw.js').replace('__BUILD__', BUILD_ID));
for (const f of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png', 'icon.svg']) fs.copyFileSync(path.join(root, 'assets', f), path.join(out, f));
fs.writeFileSync(path.join(out, 'manifest.webmanifest'), JSON.stringify({
  name: 'Harmonies', short_name: 'Harmonies', description: 'Compose your landscapes, welcome your animals — play Harmonies online with friends.',
  lang: 'en', start_url: './', scope: './', display: 'standalone', orientation: 'portrait',
  background_color: '#f7efe0', theme_color: '#1e2a5a',
  icons: [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}, null, 2));
console.log('docs/index.html : ' + html.length + ' octets (build ' + BUILD_ID + ')');
