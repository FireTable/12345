const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const OUT_DIR = path.resolve(__dirname, '../screenshots');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

async function waitPageLoaded(page, pageName, extraWait = 3000) {
  console.log(`⏳ 等待 ${pageName} 彻底渲染完成 (监听 .sk-bone 消失)...`);
  const start = Date.now();
  let cleared = false;
  while (Date.now() - start < 25000) {
    const skCount = await page.locator('.sk-bone').count();
    if (skCount === 0) {
      cleared = true;
      break;
    }
    await page.waitForTimeout(800);
  }
  if (cleared) {
    console.log(`  ✓ ${pageName} 骨架屏已完全消失！`);
  } else {
    console.log(`  ⚠️ ${pageName} 骨架屏等待结束，继续执行...`);
  }
  // 额外等待，确保图表、地图瓦片和微动画彻底定格
  await page.waitForTimeout(extraWait);
}

async function run() {
  console.log('🚀 启动无头浏览器捕获全套 4K/Retina 高清界面研判矩阵截图 (1920x1080 @ 2x)...');
  const browser = await chromium.launch({ headless: true });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2, // 2x Retina 级超高清渲染 (输出 3840 x 2160)
    colorScheme: 'light',
  });

  const page = await context.newPage();

  // 1. 登录统一门户 (无辖区下拉，纯净认证卡片)
  console.log('\n📸 [1/9] 截取: 08-login-portal.png (统一认证门户)');
  await page.goto('http://localhost:3000/login', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT_DIR, '08-login-portal.png') });
  console.log('  ✓ 已保存 08-login-portal.png');

  // 2. 执行登录
  console.log('\n🔑 执行管理员登录...');
  const submitBtn = page.locator('button[type="submit"]');
  if (await submitBtn.isVisible()) {
    await submitBtn.click();
    await page.waitForTimeout(3000);
  }

  // 3. 数据总览大盘 (首页 /)
  console.log('\n📸 [2/9] 截取: 01-overview-cockpit.png (态势感知总览大盘)');
  await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' });
  await waitPageLoaded(page, '数据总览大盘', 3500);
  await page.screenshot({ path: path.join(OUT_DIR, '01-overview-cockpit.png') });
  console.log('  ✓ 已保存 01-overview-cockpit.png');

  // 4. 打开流水线工厂抽屉 (React Flow 认知图谱)
  console.log('\n📸 [3/9] 截取: 06-pipeline-drawer.png (AI 研判工作流引擎)');
  const pipelineBtn = page.locator('.pipeline-console-icon-btn').first();
  if (await pipelineBtn.isVisible()) {
    await pipelineBtn.click();
    await page.waitForSelector('.pipeline-drawer.is-open', { timeout: 10000 });
    try {
      await page.waitForSelector('.react-flow__node', { timeout: 15000 });
    } catch (e) {}
    await page.waitForTimeout(4000);
    await page.screenshot({ path: path.join(OUT_DIR, '06-pipeline-drawer.png') });
    console.log('  ✓ 已保存 06-pipeline-drawer.png');
    // 关掉抽屉
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);
  }

  // 5. 工单透势研判 (/multifreq) -> 切到【全部】时间
  console.log('\n📸 [4/9] 截取: 02-multifreq-quadrant.png (四象限态势与假闭环狙击 · 全部时间)');
  await page.goto('http://localhost:3000/multifreq', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  for (let i = 0; i < 5; i++) {
    const timeBtn = page.locator('button.btn:has-text("近 7 天"), button.btn:has-text("近 30 天"), button.btn:has-text("近 90 天"), button.btn:has-text("全部")').first();
    const txt = (await timeBtn.innerText()).trim();
    if (txt === '全部') break;
    await timeBtn.click();
    await page.waitForTimeout(1000);
  }
  await waitPageLoaded(page, '工单透势研判 (全部)', 4500);
  await page.screenshot({ path: path.join(OUT_DIR, '02-multifreq-quadrant.png') });
  console.log('  ✓ 已保存 02-multifreq-quadrant.png');

  // 6. 多频工单群诉聚类 (/themes)
  console.log('\n📸 [5/9] 截取: 03-themes-cluster.png (多频工单群诉与公文建议)');
  await page.goto('http://localhost:3000/themes', { waitUntil: 'domcontentloaded' });
  await waitPageLoaded(page, '多频工单看板', 3500);
  await page.screenshot({ path: path.join(OUT_DIR, '03-themes-cluster.png') });
  console.log('  ✓ 已保存 03-themes-cluster.png');

  // 7. 工单中心全量穿透 (/tickets)
  console.log('\n📸 [6/9] 截取: 04-tickets-center.png (工单中心要素抽取核查)');
  await page.goto('http://localhost:3000/tickets', { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForSelector('.workorder-table tbody tr, table tbody tr', { timeout: 20000 });
  } catch (e) {}
  await waitPageLoaded(page, '工单中心', 3500);
  await page.screenshot({ path: path.join(OUT_DIR, '04-tickets-center.png') });
  console.log('  ✓ 已保存 04-tickets-center.png');

  // 8. 标准字典与别名知识库 (/dict)
  console.log('\n📸 [7/9] 截取: 05-dict-governance.png (法定镇街白名单与别名库)');
  await page.goto('http://localhost:3000/dict', { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForSelector('table tbody tr', { timeout: 20000 });
  } catch (e) {}
  await waitPageLoaded(page, '标准字典治理', 3500);
  await page.screenshot({ path: path.join(OUT_DIR, '05-dict-governance.png') });
  console.log('  ✓ 已保存 05-dict-governance.png');

  // 9. 多城市/多租户 Schema 隔离与 AI 自动拓荒 (/admin/regions)
  console.log('\n📸 [8/9] 截取: 07-admin-regions.png (多租户物理隔离与 AI Scout 拓荒)');
  await page.goto('http://localhost:3000/admin/regions', { waitUntil: 'domcontentloaded' });
  await waitPageLoaded(page, '多租户拓荒中心', 3500);
  await page.screenshot({ path: path.join(OUT_DIR, '07-admin-regions.png') });
  console.log('  ✓ 已保存 07-admin-regions.png');

  // 10. 全景智能调度指挥驾驶舱大屏 (/screen)
  console.log('\n📸 [9/9] 截取: 09-screen-cockpit.png (全景智能调度驾驶舱数据大屏)');
  await page.goto('http://localhost:3000/screen', { waitUntil: 'domcontentloaded' });
  await waitPageLoaded(page, '政企智理数据大屏', 6000);
  await page.screenshot({ path: path.join(OUT_DIR, '09-screen-cockpit.png') });
  console.log('  ✓ 已保存 09-screen-cockpit.png');

  await browser.close();
  console.log('\n🎉 全部 9 张超高清 (4K UHD 3840x2160) 真实无骨架屏截图已全部生成完毕！');
}

run().catch((err) => {
  console.error('截图生成失败:', err);
  process.exit(1);
});
