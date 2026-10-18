import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEMOS_DIR = path.join(REPO_ROOT, 'demos/latest');
const GALLERY_DIR = path.join(DEMOS_DIR, 'gallery');

// Dynamically import playwright
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  const sm3Playwright = path.resolve(REPO_ROOT, '../sm3/node_modules/playwright/index.mjs');
  ({ chromium } = await import(sm3Playwright));
}

// 1. Static HTTP Server
function startServer(port = 8765) {
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
  };

  const server = http.createServer((req, res) => {
    let filePath = path.join(REPO_ROOT, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': mimeTypes[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      fs.createReadStream(filePath).pipe(res);
    });
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      console.log(`[HTTP] Serving Heron's Fountain from ${REPO_ROOT} on http://127.0.0.1:${port}`);
      resolve(server);
    });
  });
}

// 2. Cursor helper
async function injectCursor(page) {
  await page.evaluate(() => {
    if (document.getElementById('demo-cursor')) return;
    const c = document.createElement('div');
    c.id = 'demo-cursor';
    c.style.position = 'fixed';
    c.style.top = '0';
    c.style.left = '0';
    c.style.width = '18px';
    c.style.height = '18px';
    c.style.borderRadius = '50%';
    c.style.backgroundColor = 'rgba(56, 189, 248, 0.75)';
    c.style.border = '2px solid #ffffff';
    c.style.boxShadow = '0 0 12px rgba(56, 189, 248, 0.9)';
    c.style.pointerEvents = 'none';
    c.style.zIndex = '9999999';
    c.style.transform = 'translate(-50%, -50%)';
    c.style.transition = 'width 0.12s ease, height 0.12s ease, background-color 0.12s ease';
    document.body.appendChild(c);
    window.__setCursor = (x, y) => {
      c.style.left = `${x}px`;
      c.style.top = `${y}px`;
    };
  });
}

async function smoothMove(page, targetX, targetY, steps = 18, delayMs = 15) {
  await page.mouse.move(targetX, targetY, { steps });
  await page.evaluate(({ x, y }) => window.__setCursor?.(x, y), { x: targetX, y: targetY });
  if (delayMs > 0) await page.waitForTimeout(delayMs);
}

async function smoothClick(page, selector, steps = 16) {
  const box = await page.locator(selector).boundingBox();
  if (!box) return;
  const targetX = box.x + box.width / 2;
  const targetY = box.y + box.height / 2;
  await smoothMove(page, targetX, targetY, steps);
  await page.evaluate(() => {
    const c = document.getElementById('demo-cursor');
    if (c) {
      c.style.width = '13px';
      c.style.height = '13px';
      c.style.backgroundColor = 'rgba(244, 63, 94, 0.9)';
    }
  });
  await page.waitForTimeout(100);
  await page.mouse.click(targetX, targetY);
  await page.evaluate(() => {
    const c = document.getElementById('demo-cursor');
    if (c) {
      c.style.width = '18px';
      c.style.height = '18px';
      c.style.backgroundColor = 'rgba(56, 189, 248, 0.75)';
    }
  });
  await page.waitForTimeout(200);
}

async function generateWebPThumbnail(browser, sourcePngPath, outWebPPath) {
  console.log(`[Thumbnail] Generating WebP from ${sourcePngPath}...`);
  const page = await browser.newPage();
  const pngDataUrl = `data:image/png;base64,${fs.readFileSync(sourcePngPath).toString('base64')}`;
  
  const webpBase64 = await page.evaluate(async (dataUrl) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        // Target 16:10 or 16:9 standard card ratio: 640x384
        canvas.width = 640;
        canvas.height = 384;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const webpData = canvas.toDataURL('image/webp', 0.88);
        resolve(webpData.split(',')[1]);
      };
      img.src = dataUrl;
    });
  }, pngDataUrl);

  fs.writeFileSync(outWebPPath, Buffer.from(webpBase64, 'base64'));
  await page.close();
  console.log(`[Thumbnail] Saved WebP (${fs.statSync(outWebPPath).size} bytes) to ${outWebPPath}`);
}

async function main() {
  fs.mkdirSync(GALLERY_DIR, { recursive: true });
  const server = await startServer(8765);

  console.log('[Playwright] Launching Chromium 1280x720 video recording...');
  const browser = await chromium.launch({
    headless: true,
  });

  const tempVideoDir = path.join(DEMOS_DIR, '__temp_video');
  fs.mkdirSync(tempVideoDir, { recursive: true });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: {
      dir: tempVideoDir,
      size: { width: 1280, height: 720 },
    },
  });

  const page = await context.newPage();
  const startTime = Date.now();

  try {
    console.log('[Recording] Navigating to http://127.0.0.1:8765/ ...');
    await page.goto('http://127.0.0.1:8765/', { waitUntil: 'networkidle' });
    await injectCursor(page);
    await page.evaluate(() => window.__setCursor?.(640, 360));

    // -------------------------------------------------------------------
    // Beat 1: Initial Hydrostatic Setup & Gas Pressure Climb (0.0s - 3.0s)
    // -------------------------------------------------------------------
    console.log('[1/6] Capturing Initial Hydraulic Flow & Pressure Climb...');
    await page.waitForTimeout(2000);
    // Position cursor near P2 pressure indicator
    await smoothMove(page, 510, 275, 15);
    await page.waitForTimeout(500);

    const still1 = path.join(GALLERY_DIR, '01-herons-fountain-initial-flow.png');
    await page.screenshot({ path: still1 });
    console.log(`  -> Saved ${path.basename(still1)}`);

    // -------------------------------------------------------------------
    // Beat 2: Peak Fountain Jet Ballistics & Droplet Stream (3.0s - 8.0s)
    // -------------------------------------------------------------------
    console.log('[2/6] Capturing Peak Fountain Jet & Ballistic Droplets...');
    // Move cursor tracking the water nozzle and droplet arc
    await smoothMove(page, 390, 150, 20);
    await page.waitForTimeout(1500);
    await smoothMove(page, 480, 110, 15);
    await page.waitForTimeout(1000);

    const still2 = path.join(GALLERY_DIR, '02-active-fountain-jet-ballistics.png');
    await page.screenshot({ path: still2 });
    console.log(`  -> Saved ${path.basename(still2)}`);

    // -------------------------------------------------------------------
    // Beat 3: Auto-Invert Trigger Selection & Configuration (8.0s - 14.0s)
    // -------------------------------------------------------------------
    console.log('[3/6] Interacting with Auto-Invert Controls & Triggers...');
    // Move cursor down to controls
    await smoothMove(page, 340, 642, 20);
    await page.waitForTimeout(400);

    // Select 'receiver-fill' (Lower chamber)
    await page.selectOption('#auto-trigger', 'receiver-fill');
    await page.waitForTimeout(500);

    // Hover trigger threshold input
    await smoothClick(page, '#trigger-threshold');
    await page.fill('#trigger-threshold', '75');
    await page.waitForTimeout(800);

    const still3 = path.join(GALLERY_DIR, '03-auto-invert-trigger-controls.png');
    await page.screenshot({ path: still3 });
    console.log(`  -> Saved ${path.basename(still3)}`);

    // -------------------------------------------------------------------
    // Beat 4: Dynamic Chamber Inversion (Elevation Swap) (14.0s - 19.0s)
    // -------------------------------------------------------------------
    console.log('[4/6] Triggering Inversion & Capturing Mid-Transition Swap...');
    await smoothClick(page, '#invert');
    // Mid-transition is at ~500ms into the 1.0s swap
    await page.waitForTimeout(450);

    const still4 = path.join(GALLERY_DIR, '04-chamber-inversion-transition.png');
    await page.screenshot({ path: still4 });
    console.log(`  -> Saved ${path.basename(still4)}`);

    // Allow inversion animation to complete
    await page.waitForTimeout(800);

    // -------------------------------------------------------------------
    // Beat 5: Reversed Cycle & 4x Simulation Speed (19.0s - 24.5s)
    // -------------------------------------------------------------------
    console.log('[5/6] Accelerating Simulation Speed to 4x (Reversed Flow)...');
    // Click speed once (2x)
    await smoothClick(page, '#speed');
    await page.waitForTimeout(500);
    // Click speed twice (4x)
    await smoothClick(page, '#speed');
    await page.waitForTimeout(1800);

    // Move cursor to observe reversed flow
    await smoothMove(page, 620, 260, 18);
    await page.waitForTimeout(600);

    const still5 = path.join(GALLERY_DIR, '05-reversed-cycle-high-speed.png');
    await page.screenshot({ path: still5 });
    console.log(`  -> Saved ${path.basename(still5)}`);

    // -------------------------------------------------------------------
    // Beat 6: Physics Model Documentation Dialog (24.5s - 29.5s)
    // -------------------------------------------------------------------
    console.log('[6/6] Opening "About this simulation" Technical Modal...');
    await smoothClick(page, '#about');
    await page.waitForTimeout(1400);

    const still6 = path.join(GALLERY_DIR, '06-physics-model-about-modal.png');
    await page.screenshot({ path: still6 });
    console.log(`  -> Saved ${path.basename(still6)}`);

    // Close the about modal
    await smoothClick(page, '#close-about');
    await page.waitForTimeout(400);

    // -------------------------------------------------------------------
    // Polish Final Hold to hit exactly ~30.5 seconds
    // -------------------------------------------------------------------
    const elapsedMs = Date.now() - startTime;
    const remainingMs = 30500 - elapsedMs;
    if (remainingMs > 0) {
      console.log(`[Hold] Holding final steady state for ${(remainingMs / 1000).toFixed(1)}s to complete 30.5s recording...`);
      await page.waitForTimeout(remainingMs);
    }
  } finally {
    const videoObj = page.video();
    await context.close();
    await browser.close();
    server.close();

    // Video path resolution
    const rawVideoPath = await videoObj.path();
    console.log(`[Video] Raw recording saved at: ${rawVideoPath}`);

    const finalWebM = path.join(DEMOS_DIR, 'demo.webm');
    const ffmpegMac = path.resolve(process.env.HOME, 'Library/Caches/ms-playwright/ffmpeg-1013/ffmpeg-mac');

    if (fs.existsSync(ffmpegMac)) {
      console.log(`[FFmpeg] Transcoding video with VP9 to exact 30.5s duration...`);
      await new Promise((resolve, reject) => {
        const proc = spawn(ffmpegMac, [
          '-y',
          '-i', rawVideoPath,
          '-t', '30.5',
          '-c:v', 'libvpx-vp9',
          '-b:v', '750k',
          '-crf', '32',
          '-an',
          finalWebM
        ], { stdio: 'inherit' });
        proc.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`FFmpeg exited with code ${code}`));
        });
      });
    } else {
      console.log(`[Video] Moving raw WebM to ${finalWebM}...`);
      fs.copyFileSync(rawVideoPath, finalWebM);
    }

    // Clean up temp dir
    try {
      fs.rmSync(tempVideoDir, { recursive: true, force: true });
    } catch (_) {}

    // Generate thumbnail webp
    const helperBrowser = await chromium.launch({ headless: true });
    try {
      const sourceStill = path.join(GALLERY_DIR, '02-active-fountain-jet-ballistics.png');
      const cardThumbWebP = path.join(DEMOS_DIR, 'thumb.webp');
      await generateWebPThumbnail(helperBrowser, sourceStill, cardThumbWebP);

      // Copy thumbnail into netfix / beta-livive-net / livive-net thumbnails directories
      const rootThumb = path.resolve(REPO_ROOT, '../thumbnails/herons-fountain.webp');
      const betaThumb = path.resolve(REPO_ROOT, '../beta-livive-net/thumbnails/herons-fountain.webp');
      const liviveThumb = path.resolve(REPO_ROOT, '../livive-net/thumbnails/herons-fountain.webp');

      for (const tPath of [rootThumb, betaThumb, liviveThumb]) {
        if (fs.existsSync(path.dirname(tPath))) {
          fs.copyFileSync(cardThumbWebP, tPath);
          console.log(`[Thumbnail] Copied to ${tPath}`);
        }
      }
    } finally {
      await helperBrowser.close();
    }

    console.log('[SUCCESS] All Heron\'s Fountain showcase assets captured!');
    console.log(`  - Video: ${finalWebM} (${fs.statSync(finalWebM).size} bytes)`);
    for (const f of fs.readdirSync(GALLERY_DIR).sort()) {
      const p = path.join(GALLERY_DIR, f);
      console.log(`  - Gallery: ${f} (${fs.statSync(p).size} bytes)`);
    }
  }
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
